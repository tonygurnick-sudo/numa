---
api_name: Wrike
api_slug: wrike
base_url: https://{host}/api/v4 — {host} region-resolved at RUNTIME from the OAuth token-response `host` field. NEVER hardcode www.wrike.com.
path_version_segment: /api/v4 (REAL path segment — v4 is URL-path-versioned; ALWAYS in the path. NOT a label.)
call_surface: HTTP via `numa integrations request` (connector wrike; backend handler connect_request). NOT a file-browse connector (no list-files/search-files/download-file). NOT MCP.
auth: OAuth2 (authorization_code + rotating refresh_token); `Authorization: Bearer {token}`
write_body_encoding: application/x-www-form-urlencoded (responses JSON)
id_format: opaque alphanumeric string — never numeric
spec_format: none (no published OpenAPI)
docs_url: https://developers.wrike.com/
date_researched: 2026-05-29
confidence: DOCUMENTED against developers.wrike.com — first-live-call gate NOT yet satisfied. Promote markers to [CONFIRMED] after a successful `GET /api/v4/contacts?me=true` against a real Wrike OAuth app (verify token-`host` resolution + rotating refresh-token flow).
---

# Wrike — API Specification & Investigation

Developer-facing condensed reference for implementing/extending the Wrike integration.

## Overview

- **Vendor:** Wrike, Inc. (a Citrix company)
- **API version:** `v4` (URL-path versioned; v2/v3 long deprecated)
- **Base URL (region-resolved at RUNTIME):** `https://{host}/api/v4/` — `{host}` = the `host` field in the **OAuth token response**, NOT a constant.
  - US: `www.wrike.com` → `https://www.wrike.com/api/v4/`
  - EU: `app-eu.wrike.com` → `https://app-eu.wrike.com/api/v4/` (other `app-xxx.wrike.com` hosts exist)
  - **⚠️ NEVER hardcode `www.wrike.com`** — the wrong host for an EU-resident account fails. Read `host` at connect time, store it, build every URL from it.
- **`/api/v4` is a real path segment** (path-versioned), always present.
- **Sandbox:** none — use a free/trial Wrike account.
- **API type:** REST. **Data format:** JSON responses; write bodies `application/x-www-form-urlencoded` (form params, not JSON body). `multipart`/binary for attachment up/download only.
- **Docs:** [developers.wrike.com](https://developers.wrike.com/); reference at [/api/v4/](https://developers.wrike.com/api/v4/) and ReadMe-hosted [/reference/](https://developers.wrike.com/reference/) (same v4 API). **No published OpenAPI.** Status: [status.wrike.com](https://status.wrike.com/).

The dominant Wrike-specific quirk: the correct API host is region-specific, discovered from the OAuth token response, not hardcoded.

## Authentication

OAuth 2.0 (authorization_code + refresh_token), standard RFC 6749, **rotating** refresh tokens. Auth host is a single global `login.wrike.com` for ALL regions — only the API host is region-pinned (inverse of Zoho, where the accounts host is also region-pinned).

Header: `Authorization: Bearer {access_token}` (`Bearer`/`bearer` both accepted). Registry omits `authHeaderScheme` → backend defaults to `Bearer` (correct; no override, unlike Zoho's `Zoho-oauthtoken`). Wrike also accepts the token as an `access_token` query/form param, but the header is the Numa-preferred form.

| Parameter         | Value                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (also `refresh_token`). No client_credentials / implicit                                                             |
| Authorization URL | `https://login.wrike.com/oauth2/authorize/v4` (global) [matches registry `authUrl`]                                                       |
| Token URL         | `https://login.wrike.com/oauth2/token` (global) [matches registry `tokenUrl`]                                                             |
| Revocation URL    | None public — revoke via Wrike Apps & Integrations admin UI                                                                               |
| ⚠️ Host discovery | token response carries `host`; build base URL as `https://{host}/api/v4`                                                                  |
| Access token TTL  | 1 hour (`expires_in: 3600`)                                                                                                               |
| Auth code TTL     | 10 minutes                                                                                                                                |
| Refresh token TTL | No fixed expiry, but **ROTATES** on every refresh                                                                                         |
| Refresh rotation  | **Yes** — each refresh returns a NEW access_token AND a NEW refresh_token; old pair invalidated. Persist the new refresh_token every time |
| PKCE required     | No (server-side flow)                                                                                                                     |
| `state`           | Optional but recommended (CSRF); the Numa OAuth wizard sets it                                                                            |

### Scopes (comma-delimited, case-sensitive; client default `wsReadWrite` if none requested)

| Scope                              | Purpose                                                         | Required?                                      |
| ---------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `wsReadOnly`                       | Read all workspace data (tasks, folders, comments, timelogs)    | **Yes for read-only (current registry value)** |
| `wsReadWrite`                      | Read + write all workspace data                                 | Yes for read/write integrations                |
| `Default`                          | Baseline access; usually paired with `wsRead*` on write methods | Recommended (paired)                           |
| `amReadOnlyWorkflow`               | Read workflows / custom statuses                                | Optional                                       |
| `amReadOnlyUser`/`amReadOnlyGroup` | Read users / groups (account management)                        | Optional                                       |
| `dataExportFull`                   | Full account data export API                                    | Optional (export only)                         |

**Registry-configured scope:** `wrike` sets `scopes: 'wsReadOnly'` → **read-only** (tasks, folders/projects, comments, timelogs, contacts all readable). To enable writes, widen to `Default,wsReadWrite` + user reconnect. Every write under `wsReadOnly` → `403 not_allowed`. [Confirmed against `connectorRegistry.ts` — `scopes: 'wsReadOnly'`]

## Endpoint Catalog

All paths relative to `https://{host}/api/v4`. IDs are opaque alphanumeric strings (e.g. `IEAAALZ4KQAAAAAK`), never numbers; never coerce to int, never assume ordering.

### Tasks

| Method | Path                        | Purpose                         | Paginated | Idempotent | Notes                             |
| ------ | --------------------------- | ------------------------------- | --------- | ---------- | --------------------------------- |
| GET    | `/tasks`                    | search all tasks (filters/sort) | yes       | yes        | `pageSize`+`nextPageToken`        |
| GET    | `/tasks/{id1,id2,...}`      | get task(s) by ID               | no        | yes        | CSV ids = bulk read (~100 ids)    |
| GET    | `/folders/{folderId}/tasks` | tasks in a folder/project       | yes       | yes        | preferred when scoped             |
| POST   | `/folders/{folderId}/tasks` | create a task in a folder       | no        | **no**     | form-encoded; needs `wsReadWrite` |
| PUT    | `/tasks/{id}`               | update a task (partial)         | no        | yes        | add/remove array deltas           |
| DELETE | `/tasks/{id}`               | delete a task (→ Recycle Bin)   | no        | yes        | soft delete                       |

### Folders / Projects

| Method | Path                          | Purpose                            | Paginated | Idempotent | Notes                              |
| ------ | ----------------------------- | ---------------------------------- | --------- | ---------- | ---------------------------------- |
| GET    | `/folders`                    | folder tree / filtered folders     | yes       | yes        | Tree vs Folders mode (below)       |
| GET    | `/folders/{id1,id2,...}`      | get folder(s) by ID                | no        | yes        | CSV ids                            |
| GET    | `/folders/{folderId}/folders` | child folders                      | yes       | yes        |                                    |
| POST   | `/folders/{folderId}/folders` | create folder/project under parent | no        | **no**     | `project={...}` makes it a project |
| PUT    | `/folders/{id}`               | update folder/project              | no        | yes        |                                    |
| DELETE | `/folders/{id}`               | delete folder (→ Recycle Bin)      | no        | yes        | soft delete                        |
| GET    | `/spaces`                     | list spaces (top-level homes)      | no        | yes        |                                    |

### Comments

| Method | Path                     | Purpose                                   | Idempotent | Notes                                |
| ------ | ------------------------ | ----------------------------------------- | ---------- | ------------------------------------ |
| GET    | `/comments`              | all comments (≤7-day `createdDate` range) | yes        | `?plainText=true`                    |
| GET    | `/tasks/{id}/comments`   | comments on a task                        | yes        |                                      |
| GET    | `/folders/{id}/comments` | comments on a folder                      | yes        |                                      |
| POST   | `/tasks/{id}/comments`   | add a comment to a task                   | **no**     | `text` required; needs `wsReadWrite` |
| POST   | `/folders/{id}/comments` | add a comment to a folder                 | **no**     | needs `wsReadWrite`                  |
| PUT    | `/comments/{id}`         | edit a comment                            | yes        |                                      |
| DELETE | `/comments/{id}`         | delete a comment                          | yes        |                                      |

### Timelogs

| Method | Path                      | Purpose                | Idempotent | Notes                                          |
| ------ | ------------------------- | ---------------------- | ---------- | ---------------------------------------------- |
| GET    | `/timelogs`               | all timelogs (filters) | yes        | `me`, created/tracked-date filters             |
| GET    | `/tasks/{id}/timelogs`    | timelogs on a task     | yes        |                                                |
| GET    | `/contacts/{id}/timelogs` | timelogs by a user     | yes        |                                                |
| POST   | `/tasks/{id}/timelogs`    | log time on a task     | **no**     | `hours`+`trackedDate` req; needs `wsReadWrite` |
| PUT    | `/timelogs/{id}`          | edit a timelog         | yes        |                                                |
| DELETE | `/timelogs/{id}`          | delete a timelog       | yes        |                                                |

### Contacts & Metadata

| Method | Path                | Purpose                            | Notes                                  |
| ------ | ------------------- | ---------------------------------- | -------------------------------------- |
| GET    | `/contacts?me=true` | current user (identity smoke test) | **recommended first call**             |
| GET    | `/contacts`         | list contacts/groups               | users & groups                         |
| GET    | `/contacts/{id}`    | get a contact                      |                                        |
| PUT    | `/contacts/{id}`    | update contact (limited)           | mostly self / group membership         |
| GET    | `/workflows`        | list workflows + custom statuses   | needed BEFORE setting `customStatusId` |
| GET    | `/customfields`     | list custom field definitions      | needed to resolve custom field IDs     |

### Webhooks (NOT wired into Numa — see Webhooks section)

| Method | Path             | Notes                                                                          |
| ------ | ---------------- | ------------------------------------------------------------------------------ |
| POST   | `/webhooks`      | create account webhook; also `/folders/{id}/webhooks`, `/spaces/{id}/webhooks` |
| GET    | `/webhooks`      | list webhooks                                                                  |
| DELETE | `/webhooks/{id}` | delete webhook                                                                 |

### Folder list: Tree mode vs Folders mode

`GET /folders` has two behaviours: **Tree mode** (no filters) → whole account folder tree (roots + recycle bin), use for hierarchy. **Folders mode** (any filter, or `descendants=false`) → just the matched folders, e.g. `GET /folders?project=true` lists only projects.

## Data Models

A **"Project" is not a separate entity** — a Folder carrying a `project` sub-object (status, owners, dates). Same `/folders` family. **Record ID:** opaque alphanumeric string (`"IEAAALZ4I4AAAAB"` tasks/folders, `"KUAAAAAA"` contacts), immutable, server-assigned — never parse as int, never assume order.

### Task

| Field            | Type          | Req | Writable | Notes                                                 |
| ---------------- | ------------- | --- | -------- | ----------------------------------------------------- |
| `id`             | string        | —   | no       | opaque task ID                                        |
| `title`          | string        | yes | yes      | required on create                                    |
| `description`    | string(HTML)  | no  | yes      | HTML by default; `?plainText=true` to read plain      |
| `status`         | enum          | no  | yes      | `Active`/`Completed`/`Deferred`/`Cancelled`           |
| `importance`     | enum          | no  | yes      | `High`/`Normal`/`Low`                                 |
| `customStatusId` | string        | no  | yes      | workflow status; drives the high-level `status` group |
| `dates`          | object        | no  | yes      | `{type,start,due,duration}` — JSON object on write    |
| `responsibleIds` | array<string> | no  | yes      | assignee contact IDs                                  |
| `parentIds`      | array<string> | no  | yes      | folders the task belongs to — **N:M**                 |
| `superTaskIds`   | array<string> | no  | yes      | parent tasks (this is a subtask of)                   |
| `subTaskIds`     | array<string> | —   | no       | via `fields`                                          |
| `followerIds`    | array<string> | no  | yes      | watchers                                              |
| `authorIds`      | array<string> | —   | no       | creator contact IDs                                   |
| `createdDate`    | datetime      | —   | no       | server-set                                            |
| `updatedDate`    | datetime      | —   | no       | server-set — change-detection field for polling       |
| `completedDate`  | datetime      | —   | no       | set when completed                                    |
| `customFields`   | array<object> | no  | yes      | `[{id,value}]`                                        |
| `permalink`      | string(url)   | —   | no       | web UI deep-link                                      |

Relationships: N:M to Folder/Project (`parentIds`); tree to Task (`superTaskIds`/`subTaskIds`); N:M to Contact (`responsibleIds`/`authorIds`/`followerIds`); 1:N to Comment and Timelog.

### Folder / Project

| Field          | Type          | Req | Writable | Notes                                    |
| -------------- | ------------- | --- | -------- | ---------------------------------------- |
| `id`           | string        | —   | no       | opaque folder ID                         |
| `title`        | string        | yes | yes      | folder/project name                      |
| `childIds`     | array<string> | —   | no       | child folder IDs (derived, not writable) |
| `scope`        | enum          | —   | no       | `WsRoot`/`WsFolder`/`RbRoot`/`RbFolder`  |
| `project`      | object        | no  | yes      | present iff this folder is a Project     |
| `sharedIds`    | array<string> | —   | no       | contacts the folder is shared with       |
| `customFields` | array<object> | no  | yes      | `[{id,value}]`                           |
| `permalink`    | string(url)   | —   | no       | web UI deep-link                         |

`project` sub-object: `authorId`, `ownerIds[]`, `status` (`Green`/`Yellow`/`Red`/`Completed`/`OnHold`/`Cancelled`/`Deferred`), `customStatusId`, `startDate`, `endDate`, `createdDate`, `completedDate`, `contractType`.

### Comment / Timelog / Contact (full catalogue in `01a`)

- **Comment:** `text` (HTML by default, required on create), `authorId`, `taskId`/`folderId`, `type` (`Regular`/`Email`). Account-level `GET /comments` caps the `createdDate` range at **≤7 days**.
- **Timelog:** `hours` (decimal, required), `trackedDate` (`YYYY-MM-DD`, required), `comment`, `categoryId`, `billingType` (`Billable`/`NonBillable`). Must be created on a task.
- **Contact:** `id`, `firstName`/`lastName`, `type` (`Person`/`Group`/`Asset`/`Robot`), `profiles[{accountId,email,role,admin,owner}]`, `primaryEmail`, `timezone`, `locale`, `me`. Read-mostly; no create/delete via API.

## Pagination

Cursor: `pageSize` + `nextPageToken`, BOTH in the JSON response BODY (not headers). Default page size unbounded for small lists; supply `pageSize` to opt into paging on `/tasks` and `/folders`. Max `pageSize=1000` (tasks). `responseSize` (count incl. hidden items) present on some list responses; no account-wide total without iterating.

| Parameter       | Type   | Default | Description                                           |
| --------------- | ------ | ------- | ----------------------------------------------------- |
| `pageSize`      | int    | —       | items per page; max 1000 for tasks                    |
| `nextPageToken` | string | —       | cursor from the previous response; omit on first call |

Response: `{"kind":"tasks","nextPageToken":"eyJvZmZzZXQiOjEwMDB9","responseSize":1000,"data":[/* ... */]}`
**Last page:** `nextPageToken` absent/null. **Belt-and-braces (Wrike quirk):** a `nextPageToken` can be returned even when `data` is `[]` — also stop if `data` is empty or the token didn't change. Re-send the SAME filters on every page (the cursor doesn't carry query context).

## Rate Limits

| Scope                       | Limit    | Window | Notes                                                       |
| --------------------------- | -------- | ------ | ----------------------------------------------------------- |
| Per access token / per user | 400 req  | 1 min  | primary limit                                               |
| Per IP                      | 5000 req | 1 min  | aggregate behind one IP                                     |
| DDoS guard                  | dynamic  | —      | may 429 a too-expensive request even under the stated limit |

**No reliably-returned headers** — no guaranteed `X-RateLimit-Remaining`; learn the limit via 429. `Retry-After` sometimes present (seconds). 429 body: `{"error":"rate_limit_exceeded","errorDescription":"IP or access token exceeded limit: 400 requests per minute"}` (`error` may also be `too_many_requests`). Strategy: honour `Retry-After`; else exponential backoff + jitter, base 2s, cap 60s (Wrike explicitly recommends exponential backoff). No bulk-write endpoint — loops of single-entity writes burn the 400/min budget fast, so pace deliberately.

## Error Handling

Flat error shape (no per-field `details` array, unlike Zoho): `{"error":"invalid_parameter","errorDescription":"Request parameter name or value is invalid"}`. `errorDescription` names the offending parameter — surface it verbatim.

| Status | Common codes                                                 | Retryable | Recovery                                                            |
| ------ | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------- |
| 400    | `invalid_request`, `invalid_parameter`, `parameter_required` | No        | Fix per `errorDescription` (bad array literal, bad date JSON)       |
| 401    | `not_authorized`                                             | Yes (1)   | Refresh via `/oauth2/token`; if refresh also fails → re-consent     |
| 403    | `not_allowed` (license/scope), `access_forbidden` (sharing)  | No        | `not_allowed` on a write = scope is `wsReadOnly`; widen + reconnect |
| 404    | `resource_not_found`, `method_not_found`                     | No        | Verify the opaque ID (string!) or the path                          |
| 409    | (rare; concurrent edit)                                      | Maybe     | Re-fetch, compare `updatedDate`, re-apply — last-write-wins         |
| 429    | `rate_limit_exceeded`, `too_many_requests`                   | Yes (3)   | Honour `Retry-After`; else exp. backoff base 2s cap 60s             |
| 5xx    | `server_error`, gateway (502/503)                            | Yes (3)   | Retry with backoff + jitter                                         |

Full reference: `01d` § Error model.

## Webhooks / Events

Supported by the API but **NOT wired into Numa** (no public receiver). Real-time unavailable; poll.
| Event | Trigger | Payload Summary |
| --- | --- | --- |
| `TaskCreated` | new task | `taskId`, `eventAuthorId`, `lastUpdatedDate` |
| `TaskStatusChanged` | status / custom-status change | `taskId`, `oldStatus`, `newStatus`, `old/newCustomStatusId` |
| `TaskDatesChanged` | start/due/duration change | `taskId`, old/new dates |
| `CommentAdded` | comment posted | `taskId`/`folderId`, `commentId` |
| `TimelogChanged` | timelog added/edited/deleted | `taskId`, `timelogId` |

Verification: `X-Hook-Secret` echo-back handshake on registration; `X-Hook-Signature` = `HMAC-SHA256(secret, raw body)` (hex) on every delivery. Retry: Wrike retries; sustained failures auto-**Suspend** the webhook (`status` → `Suspended`), events dropped until re-enabled. Best-effort ordering; duplicates possible (dedupe on `(eventType, taskId, lastUpdatedDate)`). Numa fallback — poll: `GET /api/v4/tasks?updatedDate={"start":"<last_poll_iso>"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000`, interval 5–15 min, change-detection field `updatedDate`. Full detail: `01d`.

## Known Limitations

1. **API host region-specific, discovered from the token** — read `host`, build `https://{host}/api/v4`, never hardcode `www.wrike.com`.
2. **Read-only until scope widened** — registry scope `wsReadOnly`; writes gated behind `Default,wsReadWrite` + reconnect (`403 not_allowed` otherwise).
3. **Refresh tokens rotate** — every refresh invalidates the previous pair; persist the new refresh_token each time.
4. **No bulk write** — single-entity creates/updates/deletes only. Bulk READ by comma-separated IDs is fine.
5. **No reliable rate-limit headers** — discover the 400/min limit via 429.
6. **No full-text search** — only `title` substring; no body/comment full-text.
7. **Write bodies form-encoded, not JSON** — array params are quoted JSON arrays (`responsibles=["KUAAAAAA"]`); date-range filters are URL-encoded JSON objects.
8. **Array updates use add/remove deltas** (`addParents`/`removeParents`, etc.), not wholesale replacement.
9. **`customStatusId` ≠ the high-level `status`** — discover valid IDs via `/workflows` before setting.
10. **Account-level `GET /comments` caps `createdDate` to ≤7 days** — scope to a task/folder for older.
11. **No OpenAPI/Swagger spec** — code against the docs manually; no maintained first-party SDK.
12. **POST create is NOT idempotent** — a retry duplicates; search by `title` before re-POSTing.

## SDKs & Tooling

| SDK                | Language | Repository                               | Quality | Notes                                                               |
| ------------------ | -------- | ---------------------------------------- | ------- | ------------------------------------------------------------------- |
| community wrappers | Python   | e.g. `github.com/wrike/python-wrike-api` | varied  | not used by Numa — we call raw REST via `numa integrations request` |
| community wrappers | Node.js  | various npm packages                     | varied  | no maintained first-party SDK                                       |

Postman collection: referenced from the Wrike Overview page; public link not captured. OpenAPI: not published.

## Integration Path Assessment

**Recommended path: Direct API Only** (HTTP via `numa integrations request`; backend handler `connect_request`).

- Wrike is structured work management (tasks, folders/projects, comments, timelogs, contacts) — not a browsable file tree, so it doesn't fit the Files (Data Connector) UX. Attachments are secondary and the request path is JSON not binary → attachment up/download out of scope for v1.
- Registry omits `surfaces` → defaults to `['chat']`, keeping it out of Files > Remote.

| Connector Method    | API Endpoint                          | Feasibility |
| ------------------- | ------------------------------------- | ----------- |
| `list_files`        | n/a — no file model                   | none        |
| `download_file`     | n/a — attachments only, not file tree | none        |
| `search_files`      | n/a — record search, not file search  | none        |
| `get_file_metadata` | n/a                                   | none        |

Any HTTP client that can do OAuth 2.0 Authorization Code, read `host` from the token response, inject `Authorization: Bearer {token}`, and persist the rotated refresh_token drives the entire surface. No vendor SDK required. Numa-internal wiring lives in the `numa-connectors` skill and `03-connector-setup.md`.

_Researched 2026-05-29. Confidence: medium — first-live-call gate not yet satisfied; promote to [CONFIRMED] after a successful `GET /api/v4/contacts?me=true` (verify token-`host` resolution + rotating refresh-token flow)._
