---
api_name: 'Wrike'
api_slug: 'wrike'
base_url: 'https://{host}/api/v4/'
version: 'v4'
spec_format: 'none'
spec_url: ''
docs_url: 'https://developers.wrike.com/'
date_researched: '2026-05-29'
---

# Wrike -- API Specification & Investigation

> Developer-facing condensed reference. Everything needed to implement or extend the
> Wrike integration, in one page. Derived from `00-api-investigation-questionnaire.md`.
>
> **Confidence:** DOCUMENTED against developers.wrike.com — the Phase 2 first-live-call gate
> is NOT yet satisfied. Promote markers to [CONFIRMED] after a successful
> `GET /api/v4/contacts?me=true` against a real Wrike OAuth app (verify the token-`host`
> resolution and the rotating refresh-token flow in particular).

---

## Overview

- **Vendor:** Wrike, Inc. (a Citrix company)
- **API version:** `v4` (URL-path versioned; v2/v3 long deprecated)
- **Base URL (region-resolved at RUNTIME):** `https://{host}/api/v4/`
  - `{host}` is the `host` field returned in the **OAuth token response** — NOT a constant.
  - US data centre: `www.wrike.com` → `https://www.wrike.com/api/v4/`
  - EU data centre: `app-eu.wrike.com` → `https://app-eu.wrike.com/api/v4/` (other `app-xxx.wrike.com` hosts exist)
  - **⚠️ NEVER hardcode `www.wrike.com`.** Calling the wrong host for an EU-resident account fails. Read `host` at connect time, store it, build every URL from it.
- **Sandbox:** No separate sandbox host — use a free/trial Wrike account for testing.
- **API type:** REST
- **Data format:** JSON responses; write bodies are **`application/x-www-form-urlencoded`** (Wrike create/update endpoints take form params, not a JSON body). `multipart`/binary for attachment up/download only.
- **Documentation:** [developers.wrike.com](https://developers.wrike.com/)
- **API reference:** [developers.wrike.com/api/v4/](https://developers.wrike.com/api/v4/) (per-entity pages) and the newer ReadMe-hosted [developers.wrike.com/reference/](https://developers.wrike.com/reference/) — same v4 API
- **OpenAPI spec:** Not published by Wrike
- **Status page:** [status.wrike.com](https://status.wrike.com/)

**Summary:** Wrike API v4 is a structured work-management REST API — folders/projects, tasks, comments, timelogs, and contacts arranged in an Account → Spaces → Folders/Projects → Tasks hierarchy. The single most important Wrike-specific quirk is that the correct API host is region-specific and is discovered from the OAuth token response, not hardcoded.

---

## Authentication

### Method: OAuth 2.0 (authorization_code + refresh_token)

Standard RFC 6749 authorization-code flow with **rotating** refresh tokens. The auth host is a single global `login.wrike.com` for ALL regions — only the API host is region-pinned (the inverse of Zoho, where the accounts host is also region-pinned).

**Header format:**

```
Authorization: Bearer {access_token}
```

Standard `Bearer` scheme (both `Bearer` and lowercase `bearer` are accepted). The connector registry omits `authHeaderScheme`, so the backend defaults to `Bearer` — no override needed (unlike Zoho's `Zoho-oauthtoken`). Wrike also accepts the token as an `access_token` query/form param, but the `Authorization: Bearer` header is the Numa-preferred form.

### OAuth 2.0 Details

| Parameter         | Value                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (also `refresh_token`). No client_credentials / no implicit.                                                                 |
| Authorization URL | `https://login.wrike.com/oauth2/authorize/v4` (global — all regions) [matches registry `authUrl`]                                                 |
| Token URL         | `https://login.wrike.com/oauth2/token` (global — all regions) [matches registry `tokenUrl`]                                                       |
| Revocation URL    | None public — apps are revoked from the Wrike Apps & Integrations admin UI                                                                        |
| ⚠️ Host discovery | The token response carries a `host` field. Build the API base URL as `https://{host}/api/v4`.                                                     |
| Access token TTL  | 1 hour (`expires_in: 3600`)                                                                                                                       |
| Auth code TTL     | 10 minutes                                                                                                                                        |
| Refresh token TTL | No fixed expiry, but **ROTATES** on every refresh                                                                                                 |
| Refresh rotation  | **Yes** — each refresh returns a NEW access_token AND a NEW refresh_token; the old pair is invalidated. Persist the new refresh_token every time. |
| PKCE required     | No (server-side flow)                                                                                                                             |
| `state`           | Optional but recommended (CSRF); the Numa OAuth wizard sets it                                                                                    |

### Required Scopes

Wrike scopes are **comma-delimited and case-sensitive**. If none requested, the client's default is `wsReadWrite`.

| Scope                              | Purpose                                                         | Required for Integration?       |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------------- |
| `wsReadOnly`                       | Read all workspace data (tasks, folders, comments, timelogs)    | **Yes for read-only** (current) |
| `wsReadWrite`                      | Read + write all workspace data                                 | Yes for read/write integrations |
| `Default`                          | Baseline access; usually paired with `wsRead*` on write methods | Recommended (paired)            |
| `amReadOnlyWorkflow`               | Read workflows / custom statuses                                | Optional                        |
| `amReadOnlyUser`/`amReadOnlyGroup` | Read users / groups (account management)                        | Optional                        |
| `dataExportFull`                   | Full account data export API                                    | Optional (export only)          |

> **Registry-configured scope:** the Numa `wrike` connector sets `scopes: 'wsReadOnly'` → **read-only** workspace access. Tasks, folders/projects, comments, timelogs and contacts are all readable. To enable writes (create/update tasks, post comments, log time) the registry scope must be widened to `Default,wsReadWrite` and the user must reconnect. Every write under `wsReadOnly` returns `403 not_allowed`. [Confirmed against `connectorRegistry.ts` — `scopes: 'wsReadOnly'`]

---

## Endpoint Catalog

> All paths are relative to `https://{host}/api/v4`. IDs are opaque alphanumeric strings (e.g. `IEAAALZ4KQAAAAAK`), **never numbers** — never coerce to int, never assume ordering.

### Tasks

| Method | Path                        | Purpose                         | Auth | Paginated | Idempotent | Notes                              |
| ------ | --------------------------- | ------------------------------- | ---- | --------- | ---------- | ---------------------------------- |
| GET    | `/tasks`                    | Search all tasks (filters/sort) | yes  | yes       | yes        | `pageSize`+`nextPageToken`         |
| GET    | `/tasks/{id1,id2,...}`      | Get task(s) by ID               | yes  | no        | yes        | CSV ids = bulk read (~100 ids)     |
| GET    | `/folders/{folderId}/tasks` | Tasks in a folder/project       | yes  | yes       | yes        | Preferred when scoped to a project |
| POST   | `/folders/{folderId}/tasks` | Create a task in a folder       | yes  | no        | **no**     | form-encoded; needs `wsReadWrite`  |
| PUT    | `/tasks/{id}`               | Update a task (partial)         | yes  | no        | yes        | add/remove array deltas            |
| DELETE | `/tasks/{id}`               | Delete a task (→ Recycle Bin)   | yes  | no        | yes        | soft delete                        |

### Folders / Projects

| Method | Path                          | Purpose                            | Auth | Paginated | Idempotent | Notes                              |
| ------ | ----------------------------- | ---------------------------------- | ---- | --------- | ---------- | ---------------------------------- |
| GET    | `/folders`                    | Folder tree / filtered folders     | yes  | yes       | yes        | Tree mode vs Folders mode (below)  |
| GET    | `/folders/{id1,id2,...}`      | Get folder(s) by ID                | yes  | no        | yes        | CSV ids                            |
| GET    | `/folders/{folderId}/folders` | Child folders                      | yes  | yes       | yes        |                                    |
| POST   | `/folders/{folderId}/folders` | Create folder/project under parent | yes  | no        | **no**     | `project={...}` makes it a project |
| PUT    | `/folders/{id}`               | Update folder/project              | yes  | no        | yes        |                                    |
| DELETE | `/folders/{id}`               | Delete folder (→ Recycle Bin)      | yes  | no        | yes        | soft delete                        |
| GET    | `/spaces`                     | List spaces (top-level homes)      | yes  | no        | yes        |                                    |

### Comments

| Method | Path                     | Purpose                                   | Auth | Idempotent | Notes                                |
| ------ | ------------------------ | ----------------------------------------- | ---- | ---------- | ------------------------------------ |
| GET    | `/comments`              | All comments (≤7-day `createdDate` range) | yes  | yes        | `?plainText=true`                    |
| GET    | `/tasks/{id}/comments`   | Comments on a task                        | yes  | yes        |                                      |
| GET    | `/folders/{id}/comments` | Comments on a folder                      | yes  | yes        |                                      |
| POST   | `/tasks/{id}/comments`   | Add a comment to a task                   | yes  | **no**     | `text` required; needs `wsReadWrite` |
| POST   | `/folders/{id}/comments` | Add a comment to a folder                 | yes  | **no**     | needs `wsReadWrite`                  |
| PUT    | `/comments/{id}`         | Edit a comment                            | yes  | yes        |                                      |
| DELETE | `/comments/{id}`         | Delete a comment                          | yes  | yes        |                                      |

### Timelogs

| Method | Path                      | Purpose                | Auth | Idempotent | Notes                                    |
| ------ | ------------------------- | ---------------------- | ---- | ---------- | ---------------------------------------- |
| GET    | `/timelogs`               | All timelogs (filters) | yes  | yes        | `me`, created/tracked-date filters       |
| GET    | `/tasks/{id}/timelogs`    | Timelogs on a task     | yes  | yes        |                                          |
| GET    | `/contacts/{id}/timelogs` | Timelogs by a user     | yes  | yes        |                                          |
| POST   | `/tasks/{id}/timelogs`    | Log time on a task     | yes  | **no**     | `hours`+`trackedDate` req; `wsReadWrite` |
| PUT    | `/timelogs/{id}`          | Edit a timelog         | yes  | yes        |                                          |
| DELETE | `/timelogs/{id}`          | Delete a timelog       | yes  | yes        |                                          |

### Contacts & Metadata

| Method | Path                | Purpose                            | Auth | Notes                                  |
| ------ | ------------------- | ---------------------------------- | ---- | -------------------------------------- |
| GET    | `/contacts?me=true` | Current user (identity smoke test) | yes  | **Recommended Phase 2 first call**     |
| GET    | `/contacts`         | List contacts/groups               | yes  | Users & groups                         |
| GET    | `/contacts/{id}`    | Get a contact                      | yes  |                                        |
| PUT    | `/contacts/{id}`    | Update contact (limited)           | yes  | Mostly self / group membership         |
| GET    | `/workflows`        | List workflows + custom statuses   | yes  | Needed BEFORE setting `customStatusId` |
| GET    | `/customfields`     | List custom field definitions      | yes  | Needed to resolve custom field IDs     |

### Webhooks (NOT wired into Numa — see Webhooks section)

| Method | Path             | Purpose                | Auth | Notes                                                  |
| ------ | ---------------- | ---------------------- | ---- | ------------------------------------------------------ |
| POST   | `/webhooks`      | Create account webhook | yes  | also `/folders/{id}/webhooks`, `/spaces/{id}/webhooks` |
| GET    | `/webhooks`      | List webhooks          | yes  |                                                        |
| DELETE | `/webhooks/{id}` | Delete webhook         | yes  |                                                        |

### Folder list: Tree mode vs Folders mode

`GET /folders` has two behaviours:

- **Tree mode** (no filters) → returns the whole account folder tree (roots + recycle bin). Use for hierarchy.
- **Folders mode** (any filter, or `descendants=false`) → returns just the matched folders. e.g. `GET /folders?project=true` lists only projects.

---

## Data Models

> A **"Project" is not a separate entity** — it is a Folder carrying a `project` sub-object (status, owners, dates). Same `/folders` endpoint family.

### Record ID

- **Type:** opaque alphanumeric string — `"IEAAALZ4I4AAAAB"` (tasks/folders), `"KUAAAAAA"` (contacts).
- **Immutable, server-assigned.** Treat as an opaque string; never parse as int, never assume order.

### Task

| Field            | Type          | Required | Writable | Notes                                                 |
| ---------------- | ------------- | -------- | -------- | ----------------------------------------------------- |
| `id`             | string        | —        | no       | Opaque task ID                                        |
| `title`          | string        | yes      | yes      | Required on create                                    |
| `description`    | string (HTML) | no       | yes      | HTML by default; `?plainText=true` to read plain      |
| `status`         | enum          | no       | yes      | `Active`/`Completed`/`Deferred`/`Cancelled`           |
| `importance`     | enum          | no       | yes      | `High`/`Normal`/`Low`                                 |
| `customStatusId` | string        | no       | yes      | Workflow status; drives the high-level `status` group |
| `dates`          | object        | no       | yes      | `{type,start,due,duration}` — JSON object on write    |
| `responsibleIds` | array<string> | no       | yes      | Assignee contact IDs                                  |
| `parentIds`      | array<string> | no       | yes      | Folders the task belongs to — **N:M**                 |
| `superTaskIds`   | array<string> | no       | yes      | Parent tasks (this is a subtask of)                   |
| `subTaskIds`     | array<string> | —        | no       | via `fields`                                          |
| `followerIds`    | array<string> | no       | yes      | Watchers                                              |
| `authorIds`      | array<string> | —        | no       | Creator contact IDs                                   |
| `createdDate`    | datetime      | —        | no       | Server-set                                            |
| `updatedDate`    | datetime      | —        | no       | Server-set — the change-detection field for polling   |
| `completedDate`  | datetime      | —        | no       | Set when completed                                    |
| `customFields`   | array<object> | no       | yes      | `[{id, value}]`                                       |
| `permalink`      | string (url)  | —        | no       | Web UI deep-link                                      |

**Relationships:** N:M to Folder/Project (`parentIds`); tree to Task (`superTaskIds`/`subTaskIds`); N:M to Contact (`responsibleIds`/`authorIds`/`followerIds`); 1:N to Comment and Timelog.

### Folder / Project

| Field          | Type          | Required | Writable | Notes                                                |
| -------------- | ------------- | -------- | -------- | ---------------------------------------------------- |
| `id`           | string        | —        | no       | Opaque folder ID                                     |
| `title`        | string        | yes      | yes      | Folder/project name                                  |
| `childIds`     | array<string> | —        | no       | Child folder IDs (hierarchy — derived, not writable) |
| `scope`        | enum          | —        | no       | `WsRoot`/`WsFolder`/`RbRoot`/`RbFolder`              |
| `project`      | object        | no       | yes      | Present iff this folder is a Project                 |
| `sharedIds`    | array<string> | —        | no       | Contacts the folder is shared with                   |
| `customFields` | array<object> | no       | yes      | `[{id, value}]`                                      |
| `permalink`    | string (url)  | —        | no       | Web UI deep-link                                     |

**`project` sub-object:** `authorId`, `ownerIds[]`, `status` (`Green`/`Yellow`/`Red`/`Completed`/`OnHold`/`Cancelled`/`Deferred`), `customStatusId`, `startDate`, `endDate`, `createdDate`, `completedDate`, `contractType`.

### Comment / Timelog / Contact

See `01a-domain-model-reference.md` for the full field catalogue. Key points:

- **Comment:** `text` (HTML by default, required on create), `authorId`, `taskId`/`folderId`, `type` (`Regular`/`Email`). Account-level `GET /comments` caps the `createdDate` range at **≤7 days**.
- **Timelog:** `hours` (decimal, required), `trackedDate` (`YYYY-MM-DD`, required), `comment`, `categoryId`, `billingType` (`Billable`/`NonBillable`). Must be created on a task.
- **Contact:** `id`, `firstName`/`lastName`, `type` (`Person`/`Group`/`Asset`/`Robot`), `profiles[{accountId,email,role,admin,owner}]`, `primaryEmail`, `timezone`, `locale`, `me`. Read-mostly; no create/delete via API.

---

## Pagination

- **Type:** cursor — `pageSize` + `nextPageToken`, BOTH carried **in the JSON response body** (not headers).
- **Default page size:** unbounded for small lists; supply `pageSize` to opt into paging on `/tasks` and `/folders`.
- **Max page size:** `1000` (tasks).
- **Total count:** `responseSize` is present on some list responses (count for that response, incl. hidden items). No documented account-wide total without iterating.

### Parameters

| Parameter       | Type   | Default | Description                                                |
| --------------- | ------ | ------- | ---------------------------------------------------------- |
| `pageSize`      | int    | —       | Items per page; max 1000 for tasks.                        |
| `nextPageToken` | string | —       | Cursor from the previous response. Omit on the first call. |

### Response structure

```json
{
  "kind": "tasks",
  "nextPageToken": "eyJvZmZzZXQiOjEwMDB9",
  "responseSize": 1000,
  "data": [
    /* ... */
  ]
}
```

### Last page detection

`nextPageToken` is absent/null in the final response. **Belt-and-braces:** a known Wrike quirk can return a `nextPageToken` even when `data` is `[]` — also stop if `data` is empty or the token didn't change. Do NOT change filter params mid-cursor — the token encodes the query context; repeat the same filters on every page.

---

## Rate Limits

| Scope                       | Limit         | Window   |
| --------------------------- | ------------- | -------- | ------------------------------------------------------------------ |
| Per access token / per user | 400 requests  | 1 minute |
| Per IP                      | 5000 requests | 1 minute |
| DDoS guard                  | dynamic       | —        | Wrike may 429 a too-expensive request even under the stated limit. |

**Headers:** none documented as reliably returned — there is **no guaranteed `X-RateLimit-Remaining`**. You learn the limit by getting a 429. `Retry-After` is sometimes present.

| Header        | Meaning                        |
| ------------- | ------------------------------ |
| `Retry-After` | Seconds to wait (when present) |

**When exceeded:** HTTP 429.

```json
{ "error": "rate_limit_exceeded", "errorDescription": "IP or access token exceeded limit: 400 requests per minute" }
```

(`error` may also be `too_many_requests`.)

**Recommended strategy:** honour `Retry-After` when present; otherwise exponential backoff with jitter, base 2s, cap 60s. Wrike explicitly recommends exponential backoff. There is **no bulk-write endpoint** — loops of single-entity writes burn the 400/min budget fast, so batch deliberately and pace.

---

## Error Handling

**Standard error format (flat — no per-field `details` array, unlike Zoho):**

```json
{
  "error": "invalid_parameter",
  "errorDescription": "Request parameter name or value is invalid"
}
```

The `errorDescription` string names the offending parameter — surface it verbatim to the user.

**Status codes:**

| Status | Common codes                                                 | Retryable | Recovery                                                            |
| ------ | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------- |
| 200    | (success)                                                    | —         | —                                                                   |
| 400    | `invalid_request`, `invalid_parameter`, `parameter_required` | No        | Fix per `errorDescription` (bad array literal, bad date JSON)       |
| 401    | `not_authorized`                                             | Yes (1)   | Refresh via `/oauth2/token`; if refresh also fails → re-consent     |
| 403    | `not_allowed` (license/scope), `access_forbidden` (sharing)  | No        | `not_allowed` on a write = scope is `wsReadOnly`; widen + reconnect |
| 404    | `resource_not_found`, `method_not_found`                     | No        | Verify the opaque ID (string!) or the path                          |
| 409    | (rare; concurrent edit)                                      | Maybe     | Re-fetch, compare `updatedDate`, re-apply — last-write-wins         |
| 429    | `rate_limit_exceeded`, `too_many_requests`                   | Yes (3)   | Honour `Retry-After`; else exponential backoff base 2s cap 60s      |
| 5xx    | `server_error`, gateway (502/503)                            | Yes (3)   | Retry with backoff + jitter                                         |

Full reference: `01d-event-and-error-handling.md` § Error model.

---

## Webhooks / Events

**Supported by the API** — but **NOT wired into Numa** (no public webhook receiver is exposed for this connector). Real-time is not available; use polling.

| Event               | Trigger                       | Payload Summary                                             |
| ------------------- | ----------------------------- | ----------------------------------------------------------- |
| `TaskCreated`       | New task                      | `taskId`, `eventAuthorId`, `lastUpdatedDate`                |
| `TaskStatusChanged` | Status / custom-status change | `taskId`, `oldStatus`, `newStatus`, `old/newCustomStatusId` |
| `TaskDatesChanged`  | Start/due/duration change     | `taskId`, old/new dates                                     |
| `CommentAdded`      | Comment posted                | `taskId`/`folderId`, `commentId`                            |
| `TimelogChanged`    | Timelog added/edited/deleted  | `taskId`, `timelogId`                                       |

**Verification:** `X-Hook-Secret` echo-back handshake on registration; `X-Hook-Signature` = `HMAC-SHA256(secret, raw body)` (hex) on every delivery.

**Retry policy:** Wrike retries failed deliveries; sustained failures auto-**Suspend** the webhook (status flips to `Suspended`) — events are dropped until re-enabled. Best-effort ordering; duplicates possible (dedupe on `(eventType, taskId, lastUpdatedDate)`).

**Numa fallback — polling:**

```http
GET /api/v4/tasks?updatedDate={"start":"<last_poll_iso>"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
```

Interval 5–15 minutes (never sub-minute on a busy account — 400 req/min budget). Change-detection field: `updatedDate`.

---

## Known Limitations

1. **API host is region-specific and discovered from the token.** The dominant gotcha — read `host` from the token response, build `https://{host}/api/v4`, never hardcode `www.wrike.com`.
2. **Read-only until scope widened.** Registry scope is `wsReadOnly`. All write capabilities are documented but gated behind `Default,wsReadWrite` + reconnect (`403 not_allowed` otherwise).
3. **Refresh tokens rotate.** Every refresh invalidates the previous pair — persist the new refresh_token each time, or lose access.
4. **No bulk write.** Single-entity creates/updates/deletes only; loop with rate-limit awareness. Bulk _read_ by comma-separated IDs is fine.
5. **No reliable rate-limit headers.** Discover the 400/min limit via 429; back off, retry.
6. **No full-text search.** Only `title` substring match is exposed — no body/comment full-text search.
7. **Write bodies are form-encoded, not JSON.** Array params are JSON arrays of quoted strings (`responsibles=["KUAAAAAA"]`); date-range filters are URL-encoded JSON objects.
8. **Array updates use add/remove deltas** (`addParents`/`removeParents`, etc.), not wholesale replacement.
9. **`customStatusId` ≠ the high-level `status`.** Discover valid IDs via `/workflows` before setting one.
10. **Account-level `GET /comments` caps `createdDate` to ≤7 days.** Scope to a task/folder for older comments.
11. **No OpenAPI/Swagger spec.** Code against the docs manually; no maintained first-party SDK.
12. **POST create is NOT idempotent.** A retried create makes a duplicate — search by `title` before re-POSTing after an ambiguous failure.

---

## SDKs & Tooling

| SDK                | Language | Repository                               | Quality            | Notes                                                     |
| ------------------ | -------- | ---------------------------------------- | ------------------ | --------------------------------------------------------- |
| community wrappers | Python   | e.g. `github.com/wrike/python-wrike-api` | varied (community) | Not used by Numa — we call raw REST via `connect_request` |
| community wrappers | Node.js  | various npm packages                     | varied (community) | No maintained first-party SDK                             |

**Postman collection:** referenced from the Wrike Overview page ("a Postman collection for testing"); public link not captured during desk research.
**OpenAPI spec:** Not published by Wrike.

---

## Integration Path Assessment

**Recommended path:** **Direct API Only**

**Justification:**

- Wrike is a structured work-management platform — tasks, folders/projects, comments, timelogs, contacts. Not a browsable file tree.
- It does not fit the "browse files" UX the Data Connector (Files) pattern is designed for. Attachments exist but are secondary, and `connect_request` sends/receives JSON, not binary streams — so attachment up/download is out of scope for v1.
- All value comes from the workspace agent making HTTP calls via `connect_request`: list/search/get (and create/update once scope is widened).
- The connector registry omits `surfaces`, so it defaults to `['chat']` — keeping it out of Files > Remote.

**Connector compatibility:**

| Connector Method    | API Endpoint                          | Feasibility |
| ------------------- | ------------------------------------- | ----------- |
| `list_files`        | n/a — no file model                   | none        |
| `download_file`     | n/a — attachments only, not file tree | none        |
| `search_files`      | n/a — record search, not file search  | none        |
| `get_file_metadata` | n/a                                   | none        |

Wrike v4 is a fully documented public REST API. Any HTTP client that can perform OAuth 2.0 Authorization Code, read `host` from the token response, inject `Authorization: Bearer {token}`, and persist the rotated refresh_token can drive the entire surface. No vendor-specific SDK required.

> Numa-internal wiring (vault keys, registry entries, integration commits) lives in the Numa connector skill and `03-connector-setup.md` — not in this API reference.

---

_Researched on 2026-05-29. Source: `00-api-investigation-questionnaire.md`. Confidence: medium — first-live-call gate not yet satisfied. Promote markers to [CONFIRMED] after a successful `GET /api/v4/contacts?me=true` against the deployed integration (verify the token-`host` resolution and rotating refresh-token flow)._
