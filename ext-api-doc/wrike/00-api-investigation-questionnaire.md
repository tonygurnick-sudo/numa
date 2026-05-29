---
api_name: 'Wrike'
api_slug: 'wrike'
vendor: 'Wrike, Inc. (a Citrix company)'
website: 'https://www.wrike.com/'
investigation_started: '2026-05-29'
investigator: 'Claude Code (Opus 4.8) — desk research against public docs'
investigation_status: 'in-progress' # blocked on live call (no test OAuth client yet)
documentation_quality: 'good'
api_types: ['REST']
overall_confidence: 'medium' # DOCUMENTED-level across the board; no [CONFIRMED] gate yet
blockers:
  - 'Phase 2.4 gate (first successful call) not satisfied — no test OAuth client / access token was available during desk research.'
  - 'Region-specific API host is only known AFTER the token exchange (token response carries `host`). The integrator MUST read `host` from the token response and NOT hardcode www.wrike.com.'
---

# API Investigation Questionnaire: Wrike

> Desk-research fill. Every downstream file cites this. Confidence markers:
> `[CONFIRMED]` live test, `[DOCUMENTED]` from official docs, `[INFERRED]`, `[UNKNOWN]`.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** `https://developers.wrike.com/` [DOCUMENTED]
- **API reference / endpoint catalog URL:** `https://developers.wrike.com/api/v4/` (per-entity pages: `/api/v4/tasks/`, `/api/v4/folders-projects/`, `/api/v4/comments/`, `/api/v4/timelogs/`, `/api/v4/contacts/`, `/api/v4/webhooks/`) [DOCUMENTED]
- **Authentication guide URL:** `https://developers.wrike.com/oauth-20-authorization/` [DOCUMENTED]
- **Error reference URL:** `https://developers.wrike.com/errors/` [DOCUMENTED]
- **Changelog / release notes URL:** `https://developers.wrike.com/change-log/` [DOCUMENTED]
- **Status page URL:** `https://status.wrike.com/` [INFERRED — standard Wrike status host; not opened during desk research]

> Wrike runs two doc surfaces — the legacy `developers.wrike.com/api/v4/<entity>/` HTML pages and a newer ReadMe-hosted reference at `developers.wrike.com/reference/`. They describe the same v4 API.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** Not published officially by Wrike. [DOCUMENTED — absence]
- **Postman collection:** Referenced from the Overview page ("a Postman collection for testing"). Public link not captured during desk research. [INFERRED]
- **Official SDKs:**
  - Python: `https://github.com/wrike/python-wrike-api` and community clients; Wrike does not maintain a first-party, current SDK. [INFERRED]
  - Node.js: no official, maintained first-party SDK; community wrappers exist on npm. [INFERRED]
- **Community forums:** Wrike Help Center community (`help.wrike.com/hc/en-us/community/`) has a developer/API section. [DOCUMENTED]
- **Third-party guides:** Rollout integration guides, Ziflow webhook guide (useful for webhook payload shapes). [DOCUMENTED]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                            |
| ------------------------- | ------ | -------------------------------------------------------------------------------- |
| Authentication            | 4      | OAuth2 auth-code flow well documented; the region-`host` mechanic is explained.  |
| Endpoint reference        | 4      | Every entity has a page with params + fields; some pages thin on response shape. |
| Request/response examples | 3      | Examples exist but are uneven across entities; not every endpoint has a sample.  |
| Error documentation       | 4      | Dedicated `/errors/` page with `error`/`errorDescription` codes + HTTP mapping.  |
| Rate limit documentation  | 4      | 400 req/min per token/user + 5000/min per IP stated; backoff guidance given.     |
| Pagination documentation  | 3      | `pageSize` + `nextPageToken` cursor model is stated but worked examples sparse.  |
| Webhook documentation     | 4      | Event list, hookUrl handshake (X-Hook-Secret), HMAC signature all documented.    |
| SDKs / code examples      | 2      | No actively maintained first-party SDK; community wrappers only.                 |
| Changelog / versioning    | 3      | Change-log page exists; v4 has been stable for years.                            |

**Overall documentation quality:** good

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed no OpenAPI/Swagger spec (confirmed: none published)
- [x] Identified authentication method (OAuth 2.0, authorization_code + refresh_token)
- [x] Found at least one working example (from vendor docs; not executed)
- [x] Identified rate limit information (400/min token+user, 5000/min IP)
- [x] Identified pagination approach (cursor — `pageSize` + `nextPageToken`)
- [x] Checked for webhook/event support (Webhooks API with HMAC-signed payloads)
- [x] Checked for official SDKs (no maintained first-party SDK)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Wrike API v4 [DOCUMENTED]
- **Vendor / company:** Wrike, Inc. (Citrix) [DOCUMENTED]
- **Current API version:** `v4` (URL-path versioned; v2/v3 long deprecated) [DOCUMENTED]
- **Base URL(s) — region-specific, resolved at runtime:**
  - Default / discovery host: `https://www.wrike.com/api/v4/` [DOCUMENTED]
  - EU data center: `https://app-eu.wrike.com/api/v4/` (or other `app-xxx.wrike.com` host) [DOCUMENTED]
  - **⚠️ The correct host is returned in the token response `host` field.** Build the base URL as `https://<host>/api/v4/`. Do NOT hardcode `www.wrike.com` — EU-resident accounts return a different host and calls to the wrong host fail. [DOCUMENTED]
  - Sandbox / testing: No separate sandbox host. Use a free/trial Wrike account for testing. [INFERRED]
- **API type:** REST [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1+ over TLS; HTTP/2 at the Wrike edge) [INFERRED]
- **Data format:** JSON [DOCUMENTED]
- **Content-Type header(s):** `application/x-www-form-urlencoded` for most write bodies (Wrike accepts form-encoded params on POST/PUT); `multipart/form-data` for attachment uploads. Responses are always JSON. [DOCUMENTED — Wrike's create/update endpoints take form params, not a JSON body]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:** `https://<host>/api/v4/{resource}` or `https://<host>/api/v4/{parent}/{parentId}/{resource}` [DOCUMENTED]

```
Example: https://www.wrike.com/api/v4/tasks
Example: https://www.wrike.com/api/v4/folders/IEAAALZ4I4AAAAB/tasks
Example: https://app-eu.wrike.com/api/v4/tasks/IEAAALZ4KQAAAAAK
```

- **Versioning strategy:** URL path — `/api/v4/` [DOCUMENTED]
- **CORS policy:** Not documented as browser-friendly; treat as server-to-server only. The workspace agent calls it server-side via `connect_request`, so CORS is not a concern for Numa. [INFERRED]

**Required headers (all requests):**

| Header          | Value                                            | Purpose                                                                   |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `Authorization` | `Bearer {access_token}`                          | OAuth2 bearer token. Standard `Bearer` scheme (unlike Zoho). [DOCUMENTED] |
| `Content-Type`  | `application/x-www-form-urlencoded` (for writes) | Wrike write endpoints take form params. [DOCUMENTED]                      |

> Wrike also accepts the access token as an `access_token` query/form parameter, but the `Authorization: Bearer` header is the recommended and Numa-preferred form. [DOCUMENTED]

### 2.3 Authentication [REQUIRED]

- **Auth method:** OAuth 2.0 [DOCUMENTED]
- **Auth location:** Header (`Authorization: Bearer {token}`) [DOCUMENTED]
- **Auth header format:** `Authorization: Bearer {access_token}` — standard bearer. [DOCUMENTED]

**For OAuth 2.0:**

- **Grant types supported:** `authorization_code`, `refresh_token`. (No client_credentials / no implicit.) [DOCUMENTED]
- **Authorization URL:** `https://login.wrike.com/oauth2/authorize/v4` [DOCUMENTED — matches registry `oauth.authUrl`]
- **Token URL:** `https://login.wrike.com/oauth2/token` [DOCUMENTED — matches registry `oauth.tokenUrl`]
- **Revocation URL:** Not documented as a public endpoint. Apps are revoked from the Wrike Apps & Integrations UI (account admin). [INFERRED]
- **Single global auth host:** `login.wrike.com` is the auth host for ALL regions. Region only affects the API host (returned via token `host`), NOT the OAuth endpoints — this is the inverse of Zoho (where the accounts host is also region-pinned). [DOCUMENTED]

**Required scopes** (comma-delimited, case-sensitive; if none requested, the client's default is `wsReadWrite`):

| Scope                   | Purpose                                                       | Required?                       |
| ----------------------- | ------------------------------------------------------------- | ------------------------------- |
| `Default`               | Baseline access; paired with `wsRead*` on most write methods. | Recommended (paired)            |
| `wsReadOnly`            | Read all workspace data (tasks, folders, comments, timelogs). | Yes for read-only integrations  |
| `wsReadWrite`           | Read + write all workspace data.                              | Yes for read/write integrations |
| `amReadOnlyGroup`       | Read user groups (account management).                        | Optional                        |
| `amReadWriteGroup`      | Manage user groups.                                           | Optional                        |
| `amReadOnlyUser`        | Read users (account management).                              | Optional                        |
| `amReadWriteUser`       | Manage users.                                                 | Optional                        |
| `amReadOnlyInvitation`  | Read invitations.                                             | Optional                        |
| `amReadWriteInvitation` | Manage invitations.                                           | Optional                        |
| `amReadOnlyWorkflow`    | Read workflows / custom statuses.                             | Optional                        |
| `amReadWriteWorkflow`   | Manage workflows.                                             | Optional                        |
| `dataExportFull`        | Full account data export API.                                 | Optional (export only)          |

**Registry-configured scope:** the Numa connector entry sets `scopes: 'wsReadOnly'` → **read-only** workspace access (tasks, folders/projects, comments, timelogs, contacts are all readable). To enable writes (create/update tasks, post comments, log time) the registry scope must be widened to `wsReadWrite` (typically `Default,wsReadWrite`). [CONFIRMED against connectorRegistry.ts line 352 — `scopes: 'wsReadOnly'`]

- **Token lifetime:** access token = 1 hour (3600s); authorization code = 10 minutes. [DOCUMENTED]
- **Refresh token behavior:** **ROTATING.** Each `refresh_token` grant returns a NEW access_token AND a NEW refresh_token, invalidating the previous pair. The integrator MUST persist the new refresh_token on every refresh or it will lose access. This is a key difference from Zoho (non-rotating). [DOCUMENTED]
- **PKCE required?** No (server-side auth-code flow). [DOCUMENTED]
- **State parameter:** Optional but recommended (our OAuth wizard uses it for CSRF protection). [INFERRED]
- **Redirect URI restrictions:** Must be HTTPS (use `https://localhost` for local dev). Must match exactly between the authorize and token-exchange requests when multiple callbacks are registered on the app. [DOCUMENTED]
- **Token response carries the host:** the single most important Wrike-specific gotcha — see §2.4.

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

**Blocked on desk research.** No live OAuth client / access token was available during this investigation. The flow below is the exact shape from Wrike's docs and what the agent must attempt as the Phase 2 live-gate before claiming [CONFIRMED] quality.

**Step A — token exchange (where the host is discovered):**

```http
POST /oauth2/token HTTP/1.1
Host: login.wrike.com
Content-Type: application/x-www-form-urlencoded

client_id=xxx&client_secret=yyy&grant_type=authorization_code&code=AUTH_CODE&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback
```

**Documented token response shape** (verbatim from vendor docs):

```json
{
  "access_token": "eyJ0dCI6InAiLCJh...",
  "refresh_token": "eyJ0dCI6InIiLCJh...",
  "token_type": "bearer",
  "expires_in": 3600,
  "host": "www.wrike.com"
}
```

> Read `host` and build the API base URL as `https://www.wrike.com/api/v4`. For an EU account `host` would be e.g. `app-eu.wrike.com`. [DOCUMENTED]

**Step B — first API call (identity / smoke test):**

```http
GET /api/v4/contacts?me=true HTTP/1.1
Host: www.wrike.com
Authorization: Bearer eyJ0dCI6InAiLCJh...
Accept: application/json
```

**Documented response shape:**

```json
{
  "kind": "contacts",
  "data": [
    {
      "id": "KUAAAAAA",
      "firstName": "Jane",
      "lastName": "Smith",
      "type": "Person",
      "profiles": [
        { "accountId": "IEAAAAAA", "email": "jane@example.com", "role": "User", "admin": true, "owner": false }
      ],
      "avatarUrl": "https://www.wrike.com/avatars/...",
      "timezone": "Pacific/Auckland",
      "locale": "en",
      "deleted": false,
      "me": true,
      "primaryEmail": "jane@example.com"
    }
  ]
}
```

- **HTTP status code (expected):** 200 [DOCUMENTED]
- **Response headers of note:** none documented as load-bearing for paging; pagination is in the body (`nextPageToken`). [DOCUMENTED]
- **Time to first successful call:** N/A — blocked.
- **Gotchas encountered during setup (predicted):**
  1. Calling `www.wrike.com` for an EU account → wrong host → failure. ALWAYS use `host` from the token response.
  2. Using `wsReadOnly` (the registry default) then attempting a write → `403 not_allowed`. Widen scope to `wsReadWrite` first.
  3. Not persisting the rotated refresh_token → next refresh fails with `not_authorized`.

- [ ] **GATE CHECK: First successful API call completed and documented above** — NOT YET. All downstream docs labelled [DOCUMENTED] until an engineer runs `GET /api/v4/contacts?me=true` post-install and promotes markers to [CONFIRMED].

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

Wrike's hierarchy: **Account → Spaces → Folders/Projects → Tasks → (Comments, Timelogs, Attachments)**. A "Project" is a Folder with a `project` object attached — same endpoint family, distinguished by the presence of `project`.

#### Entity: Folder / Project

- **API resource name / endpoint path:** `/api/v4/folders`, `/api/v4/folders/{folderId}`, `/api/v4/folders/{folderId}/folders`, `/api/v4/spaces/{spaceId}/folders`
- **Description:** A container in the work hierarchy. A Folder becomes a Project when it carries a `project` sub-object (status, owners, dates). [DOCUMENTED]
- **CRUD support:** Create (under a parent folder/space), Read, Update, Delete. [DOCUMENTED]

**Fields:**

| Field          | Type          | Required? | Writable? | Description                                           | Example                                   |
| -------------- | ------------- | --------- | --------- | ----------------------------------------------------- | ----------------------------------------- |
| `id`           | string        | —         | no        | Opaque Wrike ID (alphanumeric, e.g. `IEAAALZ4I4...`)  | `"IEAAALZ4I4AAAAB"`                       |
| `title`        | string        | yes       | yes       | Folder/project name                                   | `"Q3 Launch"`                             |
| `childIds`     | array<string> | —         | no        | Child folder IDs (hierarchy)                          | `["IEAA...","IEAB..."]`                   |
| `scope`        | enum          | —         | no        | `WsFolder` / `WsRoot` / `RbFolder` / `RbRoot`         | `"WsFolder"`                              |
| `project`      | object        | no        | yes       | Present iff this folder is a Project (see sub-fields) | `{ "status": "Green" }`                   |
| `customFields` | array<object> | no        | yes       | `[{id, value}]`                                       |                                           |
| `permalink`    | string (url)  | —         | no        | Web UI deep-link                                      | `"https://www.wrike.com/open.htm?id=..."` |
| `description`  | string        | no        | yes       | Optional (request via `fields`)                       |                                           |
| `sharedIds`    | array<string> | —         | no        | Contacts the folder is shared with                    |                                           |
| `space`        | bool          | —         | no        | Whether folder is a space root (via `fields`)         |                                           |

**`project` sub-object fields:** `authorId`, `ownerIds[]`, `status` (enum), `customStatusId`, `startDate`, `endDate`, `createdDate`, `completedDate`, `contractType`. [DOCUMENTED]

**Relationships:**

| Related Entity | Relationship Type | How Expressed                            | Notes                           |
| -------------- | ----------------- | ---------------------------------------- | ------------------------------- |
| Folder (child) | 1:N               | `childIds[]`                             | Tree hierarchy                  |
| Task           | 1:N               | `/folders/{id}/tasks` and task.parentIds | A task can live in many folders |
| Space          | N:1               | `/spaces/{id}/folders`                   | Spaces are top-level homes      |
| Contact        | N:M               | `sharedIds[]`                            | Sharing                         |

#### Entity: Task

- **API resource name:** `/api/v4/tasks`, `/api/v4/tasks/{taskId}`, `/api/v4/folders/{folderId}/tasks` (create), `/api/v4/tasks?folderId=` (scoped read)
- **Description:** The primary unit of work. Can be nested (subtasks via `superTaskIds`/`subTaskIds`), have dependencies, and span multiple folders. [DOCUMENTED]
- **CRUD support:** Create, Read, Update, Delete. [DOCUMENTED]

**Fields:**

| Field            | Type          | Required? | Writable? | Description                                        | Example                  |
| ---------------- | ------------- | --------- | --------- | -------------------------------------------------- | ------------------------ |
| `id`             | string        | —         | no        | Opaque task ID                                     | `"IEAAALZ4KQAAAAAK"`     |
| `title`          | string        | yes       | yes       | Task name                                          | `"Write spec"`           |
| `description`    | string (HTML) | no        | yes       | HTML body (plain text on request)                  | `"<p>...</p>"`           |
| `status`         | enum          | no        | yes       | High-level state — see 3.3                         | `"Active"`               |
| `importance`     | enum          | no        | yes       | `High` / `Normal` / `Low`                          | `"Normal"`               |
| `customStatusId` | string        | no        | yes       | Workflow-specific status (drives `status` mapping) | `"IEAAALZ4JMAAAAA"`      |
| `dates`          | object        | no        | yes       | `{type, start, due, duration}` (planned schedule)  | `{"due":"2026-06-01"}`   |
| `scheduledDate`  | date          | no        | yes       | (via `fields`)                                     | `"2026-06-01"`           |
| `completedDate`  | datetime      | —         | no        | Set when task completed                            |                          |
| `createdDate`    | datetime      | —         | no        | Server-set                                         | `"2026-05-29T01:00:00Z"` |
| `updatedDate`    | datetime      | —         | no        | Server-set (change-detection field)                |                          |
| `parentIds`      | array<string> | no        | yes       | Folders the task belongs to                        | `["IEAAALZ4I4..."]`      |
| `superTaskIds`   | array<string> | no        | yes       | Parent tasks (this is a subtask of)                |                          |
| `subTaskIds`     | array<string> | —         | no        | Child tasks (via `fields`)                         |                          |
| `responsibleIds` | array<string> | no        | yes       | Assignee contact IDs                               | `["KUAAAAAA"]`           |
| `authorIds`      | array<string> | —         | no        | Creator contact IDs                                |                          |
| `followerIds`    | array<string> | no        | yes       | Watchers                                           |                          |
| `permalink`      | string (url)  | —         | no        | Web UI deep-link                                   |                          |
| `customFields`   | array<object> | no        | yes       | `[{id, value}]`                                    |                          |
| `dependencyIds`  | array<string> | —         | no        | (via `fields`) Gantt dependencies                  |                          |

**Relationships:**

| Related Entity | Relationship Type | How Expressed                              | Notes                             |
| -------------- | ----------------- | ------------------------------------------ | --------------------------------- |
| Folder/Project | N:M               | `parentIds[]`                              | A task can be in multiple folders |
| Task (sub)     | tree              | `superTaskIds`/`subTaskIds`                | Subtask nesting                   |
| Contact        | N:M               | `responsibleIds`,`authorIds`,`followerIds` | Assignment                        |
| Comment        | 1:N               | `/tasks/{id}/comments`                     | Discussion                        |
| Timelog        | 1:N               | `/tasks/{id}/timelogs`                     | Time tracking                     |

#### Entity: Comment

- **API resource name:** `/api/v4/comments`, `/api/v4/tasks/{taskId}/comments`, `/api/v4/folders/{folderId}/comments`, `/api/v4/comments/{commentId}`
- **Description:** A discussion entry on a task or folder. [DOCUMENTED]
- **CRUD support:** Create (on a task/folder), Read, Update, Delete. [DOCUMENTED]

| Field         | Type     | Required? | Writable? | Notes                                        |
| ------------- | -------- | --------- | --------- | -------------------------------------------- |
| `id`          | string   | —         | no        | Opaque comment ID                            |
| `authorId`    | string   | —         | no        | Contact ID of author                         |
| `text`        | string   | yes       | yes       | HTML by default; `?plainText=true` for plain |
| `createdDate` | datetime | —         | no        |                                              |
| `updatedDate` | datetime | —         | no        | (via `fields`)                               |
| `taskId`      | string   | —         | no        | Set if comment is on a task                  |
| `folderId`    | string   | —         | no        | Set if comment is on a folder                |
| `type`        | enum     | —         | no        | `Regular` / `Email` (via `fields`)           |

> Account-level `GET /comments` accepts a `createdDate` range **≤ 7 days**. [DOCUMENTED]

#### Entity: Timelog

- **API resource name:** `/api/v4/timelogs`, `/api/v4/tasks/{taskId}/timelogs`, `/api/v4/timelogs/{timelogId}`, `/api/v4/contacts/{contactId}/timelogs`
- **Description:** A time-tracking record against a task. [DOCUMENTED]
- **CRUD support:** Create (on a task), Read, Update, Delete. [DOCUMENTED]

| Field            | Type     | Required? | Writable? | Notes                                     |
| ---------------- | -------- | --------- | --------- | ----------------------------------------- |
| `id`             | string   | —         | no        | Opaque timelog ID                         |
| `taskId`         | string   | —         | no        | Owning task                               |
| `userId`         | string   | —         | no        | Contact who logged the time               |
| `categoryId`     | string   | no        | yes       | Timelog category                          |
| `hours`          | number   | yes       | yes       | Decimal hours (e.g. `1.5`)                |
| `trackedDate`    | date     | yes       | yes       | The day the work happened (`YYYY-MM-DD`)  |
| `createdDate`    | datetime | —         | no        |                                           |
| `updatedDate`    | datetime | —         | no        |                                           |
| `comment`        | string   | no        | yes       | Free-text note                            |
| `billingType`    | enum     | no        | yes       | (via `fields`) `Billable` / `NonBillable` |
| `approvalStatus` | enum     | —         | no        | (via `fields`)                            |

#### Entity: Contact (User / Group)

- **API resource name:** `/api/v4/contacts`, `/api/v4/contacts/{contactId}`
- **Description:** A user, user group, or other actor in the account. Read-mostly. [DOCUMENTED]
- **CRUD support:** Read; limited Update via `PUT /contacts/{contactId}` (e.g. current user's own profile, group membership). No create/delete via API. [DOCUMENTED]

| Field          | Type          | Required? | Writable? | Notes                                            |
| -------------- | ------------- | --------- | --------- | ------------------------------------------------ |
| `id`           | string        | —         | no        | Opaque contact ID                                |
| `firstName`    | string        | —         | partial   |                                                  |
| `lastName`     | string        | —         | partial   |                                                  |
| `type`         | enum          | —         | no        | `Person` / `Group` / `Asset` / `Robot`           |
| `profiles`     | array<object> | —         | no        | Per-account `{accountId,email,role,admin,owner}` |
| `primaryEmail` | string        | —         | no        |                                                  |
| `avatarUrl`    | string        | —         | no        |                                                  |
| `timezone`     | string        | —         | no        | IANA tz                                          |
| `locale`       | string        | —         | no        |                                                  |
| `deleted`      | bool          | —         | no        |                                                  |
| `me`           | bool          | —         | no        | True on the requesting user's own contact        |

### 3.2 Entity Relationships [IMPORTANT]

```
                ┌──────────┐
                │  Account │
                └────┬─────┘
                     │ 1:N
                     ▼
                ┌──────────┐        ┌───────────┐
                │  Space   │        │  Contact  │ (Person / Group)
                └────┬─────┘        └─────┬─────┘
                     │ 1:N                │  shared / assigned / author
                     ▼                    │
            ┌──────────────────┐          │
            │ Folder / Project │◄─────────┘ N:M (sharedIds)
            └────────┬─────────┘
        childIds 1:N │  parentIds N:M
                     ▼
                ┌──────────┐   superTaskIds (tree)
                │   Task   │◄──────────┐
                └────┬─────┘           │ subtasks
          ┌──────────┼──────────┐──────┘
          ▼          ▼          ▼
     ┌─────────┐ ┌────────┐ ┌──────────┐
     │ Comment │ │Timelog │ │Attachment│
     └─────────┘ └────────┘ └──────────┘
```

Key non-obvious shape: a Task's `parentIds` is **N:M** — a single task can appear in multiple folders/projects simultaneously. A "Project" is not a separate entity — it is a Folder carrying a `project` sub-object. [DOCUMENTED]

### 3.3 State Machines [IMPORTANT]

#### State Machine: Task.status (high-level) + customStatusId (workflow)

Wrike has TWO status layers: a fixed high-level `status` enum, and an account-configurable `customStatusId` (workflow status) that MAPS to one of the high-level values.

```
[Active] ──► [Completed]
   │  ▲           │
   │  └───────────┘  (reopen)
   ▼
[Deferred]            [Cancelled]
   │                      ▲
   └──────────────────────┘
```

| From State | Action/Trigger       | To State  | Reversible? | Side Effects                       |
| ---------- | -------------------- | --------- | ----------- | ---------------------------------- |
| Active     | set status=Completed | Completed | yes         | `completedDate` set; webhook fires |
| Active     | set status=Deferred  | Deferred  | yes         | —                                  |
| Active     | set status=Cancelled | Cancelled | yes         | —                                  |
| Completed  | set status=Active    | Active    | yes         | `completedDate` cleared            |

**Per-state capabilities:**

| State     | Can Update? | Can Delete? | Notes                       |
| --------- | ----------- | ----------- | --------------------------- |
| Active    | yes         | yes         | Normal working state        |
| Completed | yes         | yes         | Still editable              |
| Deferred  | yes         | yes         | Paused / on-hold            |
| Cancelled | yes         | yes         | Soft-cancelled, not deleted |

> Setting `customStatusId` is the correct way to move a task into a specific workflow column; the high-level `status` follows the custom status's group. Discover valid custom statuses via the Workflows API (`/api/v4/workflows`). [DOCUMENTED]

#### State Machine: Project.status

```
[Green] ──► [Yellow] ──► [Red]        [OnHold]
   └──────────┴──────────┴──► [Completed] / [Cancelled] / [Deferred]
```

Default project status enum: `Green`, `Yellow`, `Red`, `Completed`, `OnHold`, `Cancelled`, `Deferred`. [DOCUMENTED]

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- A Task must be created under a parent — `POST /folders/{folderId}/tasks` (or via `superTask`). You cannot create a free-floating task at account root via the public API. [DOCUMENTED]
- A Timelog must be created on a Task — `POST /tasks/{taskId}/timelogs`. [DOCUMENTED]
- A Comment must be created on a Task or Folder — there is no account-level comment create. [DOCUMENTED]

**Field-level rules:**

- `title` is required on task/folder create. [DOCUMENTED]
- `hours` and `trackedDate` are required on timelog create. [DOCUMENTED]
- Dates are `YYYY-MM-DD` (date) or ISO 8601 (`YYYY-MM-DDThh:mm:ssZ`) for datetimes; Wrike emits `Z` UTC. [DOCUMENTED]
- `description` and `comment.text` are HTML by default; pass `plainText=true` to read plain text. [DOCUMENTED]

**Cascading effects:**

- Deleting a Folder moves it (and exclusively-contained tasks) to the Recycle Bin (soft delete), accessible via the recycle-bin scope. [DOCUMENTED]
- Deleting a Task soft-deletes (Recycle Bin); subtasks follow. [INFERRED]
- Removing a task's last `parentId` may move it to the Recycle Bin (a task must live somewhere). [INFERRED]

**Uniqueness constraints:**

- No documented title-uniqueness constraint — duplicate folder/task titles are allowed. [INFERRED]

**Computed / read-only fields:**

- `id`, `createdDate`, `updatedDate`, `authorIds`, `permalink`, `completedDate` — server-set. [DOCUMENTED]
- A Folder's `childIds` is derived from the hierarchy, not directly writable. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern                    | Example                           | Notes                                        |
| ----------- | -------------------------- | --------------------------------- | -------------------------------------------- |
| Date        | `YYYY-MM-DD`               | `2026-06-01`                      | Timelog `trackedDate`, project dates         |
| DateTime    | ISO 8601 UTC               | `2026-05-29T01:00:00Z`            | `createdDate`/`updatedDate`; Wrike emits `Z` |
| Date range  | `{"start":...,"end":...}`  | `start=2026-05-01,end=2026-05-31` | Filter params; comments capped at 7 days     |
| Currency    | n/a                        | —                                 | No currency fields in core entities          |
| Record ID   | opaque alphanumeric string | `"IEAAALZ4I4AAAAB"`               | NOT numeric — treat as opaque string         |
| Hours       | decimal number             | `1.5`                             | Timelog hours                                |
| Enum values | See 3.6                    | `"Active"`                        | Case-sensitive                               |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity  | Field         | Allowed Values                                                           | Default   | Notes                        |
| ------- | ------------- | ------------------------------------------------------------------------ | --------- | ---------------------------- |
| Task    | `status`      | `Active`, `Completed`, `Deferred`, `Cancelled`                           | `Active`  | High-level; not customisable |
| Task    | `importance`  | `High`, `Normal`, `Low`                                                  | `Normal`  |                              |
| Project | `status`      | `Green`, `Yellow`, `Red`, `Completed`, `OnHold`, `Cancelled`, `Deferred` | `Green`   |                              |
| Contact | `type`        | `Person`, `Group`, `Asset`, `Robot`                                      | —         |                              |
| Comment | `type`        | `Regular`, `Email`                                                       | `Regular` |                              |
| Timelog | `billingType` | `Billable`, `NonBillable`                                                | —         | via `fields`                 |
| Folder  | `scope`       | `WsRoot`, `WsFolder`, `RbRoot`, `RbFolder`                               | —         | Ws=workspace, Rb=recycle bin |

Custom-status values (`customStatusId`) are tenant-defined — discover via `GET /api/v4/workflows`. [DOCUMENTED]

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /api/v4/tasks

- **Purpose:** Search all tasks in the account with filters, sorting, and pagination.
- **Auth:** required (`wsReadOnly` or `wsReadWrite`).
- **Idempotent:** yes.

**Query parameters (subset):**

| Parameter        | Type   | Required | Default | Description                                                              |
| ---------------- | ------ | -------- | ------- | ------------------------------------------------------------------------ |
| `title`          | string | no       | —       | Contains-match on title                                                  |
| `status`         | enum   | no       | —       | `Active`/`Completed`/`Deferred`/`Cancelled` (comma list)                 |
| `importance`     | enum   | no       | —       | `High`/`Normal`/`Low`                                                    |
| `customStatuses` | CSV    | no       | —       | Filter by workflow custom status IDs                                     |
| `createdDate`    | range  | no       | —       | `{"start":...,"end":...}` (URL-encoded JSON)                             |
| `updatedDate`    | range  | no       | —       | Polling-friendly change filter                                           |
| `dueDate`        | range  | no       | —       |                                                                          |
| `responsibles`   | array  | no       | —       | Assignee contact IDs                                                     |
| `authors`        | array  | no       | —       | Author contact IDs                                                       |
| `fields`         | array  | no       | —       | Request optional fields (`subTaskIds`, `description`, `customFields`, …) |
| `sortField`      | enum   | no       | —       | e.g. `CreatedDate`, `UpdatedDate`, `Status`, `Importance`, `DueDate`     |
| `sortOrder`      | enum   | no       | `Asc`   | `Asc` / `Desc`                                                           |
| `pageSize`       | int    | no       | —       | Max 1000                                                                 |
| `nextPageToken`  | string | no       | —       | Cursor from previous response's `responseHeader.nextPageToken`           |

**Success response (200):**

```json
{
  "kind": "tasks",
  "nextPageToken": "ABC123...",
  "responseSize": 245,
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
      "scope": "WsTask",
      "customStatusId": "IEAAALZ4JMAAAAA",
      "permalink": "https://www.wrike.com/open.htm?id=1234567",
      "priority": "0000...",
      "responsibleIds": ["KUAAAAAA"],
      "parentIds": ["IEAAALZ4I4AAAAB"]
    }
  ]
}
```

**Error responses:**

| Status | Error Code            | Meaning                           | Recovery                    |
| ------ | --------------------- | --------------------------------- | --------------------------- |
| 400    | `invalid_parameter`   | Bad filter value / malformed JSON | Fix the param               |
| 401    | `not_authorized`      | Token expired / invalid           | Refresh via `/oauth2/token` |
| 429    | `rate_limit_exceeded` | >400 req/min                      | Backoff + retry             |

[DOCUMENTED]

#### Endpoint: GET /api/v4/folders

- **Purpose:** Get the folder/project tree (no filters) or a filtered set (with filters / `descendants=false`).
- **Auth:** required.
- **Idempotent:** yes.

**Query parameters:** `permalink`, `descendants` (bool), `project` (bool — projects only), `deleted` (bool — recycle bin), `customFields`, `title`, `status`, `startDate`, `endDate`, `completedDate`, `owners`, `authors`, `pageSize`, `nextPageToken`, `fields`. [DOCUMENTED]

> Two modes: **Tree mode** (no filters → returns the whole account folder tree + roots + recycle bin) vs **Folders mode** (any filter or `descendants=false` → returns just the matched folders). [DOCUMENTED]

**Success response (200):**

```json
{
  "kind": "folders",
  "data": [
    {
      "id": "IEAAALZ4I4AAAAB",
      "title": "Q3 Launch",
      "childIds": ["IEAAALZ4I5AAAAC"],
      "scope": "WsFolder",
      "project": {
        "authorId": "KUAAAAAA",
        "ownerIds": ["KUAAAAAA"],
        "status": "Green",
        "startDate": "2026-06-01",
        "endDate": "2026-08-31"
      },
      "permalink": "https://www.wrike.com/open.htm?id=2345678"
    }
  ]
}
```

#### Endpoint: GET /api/v4/folders/{folderId}/tasks

- **Purpose:** List tasks inside a specific folder/project.
- **Auth:** required.
- Same query params as `GET /tasks`. Preferred over the account-wide search when scoped to a project. [DOCUMENTED]

#### Endpoint: POST /api/v4/folders/{folderId}/tasks

- **Purpose:** Create a task in a folder/project.
- **Auth:** required (`wsReadWrite`).
- **Idempotent:** no.
- **Content-Type:** `application/x-www-form-urlencoded`.

**Request body (form-encoded):**

```
title=Write the spec&description=<p>Draft v1</p>&status=Active&importance=Normal&responsibles=[KUAAAAAA]&dates={"due":"2026-06-01"}
```

**Success response (200):**

```json
{ "kind": "tasks", "data": [{ "id": "IEAAALZ4KQAAAAAK", "title": "Write the spec", "status": "Active" }] }
```

#### Endpoint: PUT /api/v4/tasks/{taskId}

- **Purpose:** Update a task (partial — only supplied fields change).
- **Auth:** required (`wsReadWrite`).
- **Idempotent:** yes (re-applying same body yields same state).
- **Body (form):** `title=...&status=Completed&customStatusId=...&addParents=[...]&removeParents=[...]&addResponsibles=[...]`.

> Array fields use add/remove deltas (`addParents`/`removeParents`, `addResponsibles`/`removeResponsibles`, `addFollowers`/`removeFollowers`) rather than wholesale replacement. [DOCUMENTED]

#### Endpoint: GET /api/v4/tasks/{taskId}/comments and POST /api/v4/tasks/{taskId}/comments

- **GET Purpose:** List comments on a task. `?plainText=true` for plain text.
- **POST Purpose:** Add a comment. Body: `text=Looks good&plainText=true`.
- **Auth:** read / write respectively.

#### Endpoint: GET /api/v4/tasks/{taskId}/timelogs and POST /api/v4/tasks/{taskId}/timelogs

- **POST Purpose:** Log time on a task.
- **Body (form):** `hours=1.5&trackedDate=2026-05-29&comment=Spec drafting&categoryId=...`.
- **Auth:** write.

#### Endpoint: GET /api/v4/contacts?me=true

- **Purpose:** Identity smoke test — returns the requesting user's contact. The recommended Phase 2 first call.
- **Auth:** read.

#### Endpoint: GET /api/v4/workflows

- **Purpose:** Discover custom statuses (the valid `customStatusId` values per workflow) — required BEFORE setting a workflow status on a task. [DOCUMENTED]
- **Auth:** read (`amReadOnlyWorkflow` or `wsReadOnly`).

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path                             | Purpose                              | Auth | Paginated | Notes                                                  |
| ------ | -------------------------------- | ------------------------------------ | ---- | --------- | ------------------------------------------------------ |
| GET    | `/api/v4/contacts`               | List contacts/groups (`?me=true`)    | yes  | no\*      | Identity smoke test                                    |
| GET    | `/api/v4/contacts/{id}`          | Get a contact                        | yes  | no        |                                                        |
| PUT    | `/api/v4/contacts/{id}`          | Update contact (limited)             | yes  | no        | Mostly self / group membership                         |
| GET    | `/api/v4/spaces`                 | List spaces                          | yes  | no        | Top-level homes                                        |
| GET    | `/api/v4/folders`                | Folder tree / filtered folders       | yes  | yes       | Tree vs Folders mode                                   |
| GET    | `/api/v4/folders/{id}`           | Get folders by ID (batch by CSV ids) | yes  | no        |                                                        |
| GET    | `/api/v4/folders/{id}/folders`   | Child folders                        | yes  | yes       |                                                        |
| POST   | `/api/v4/folders/{id}/folders`   | Create folder/project under parent   | yes  | no        | `project={...}` makes a project                        |
| PUT    | `/api/v4/folders/{id}`           | Update folder/project                | yes  | no        |                                                        |
| DELETE | `/api/v4/folders/{id}`           | Delete folder (→ Recycle Bin)        | yes  | no        | Soft delete                                            |
| GET    | `/api/v4/tasks`                  | Search all tasks                     | yes  | yes       | `nextPageToken`                                        |
| GET    | `/api/v4/tasks/{id}`             | Get task(s) by ID                    | yes  | no        | CSV ids supported                                      |
| GET    | `/api/v4/folders/{id}/tasks`     | Tasks in a folder                    | yes  | yes       |                                                        |
| POST   | `/api/v4/folders/{id}/tasks`     | Create task in folder                | yes  | no        | form-encoded                                           |
| PUT    | `/api/v4/tasks/{id}`             | Update task                          | yes  | no        | add/remove array deltas                                |
| DELETE | `/api/v4/tasks/{id}`             | Delete task (→ Recycle Bin)          | yes  | no        | Soft delete                                            |
| GET    | `/api/v4/comments`               | All comments (≤7-day `createdDate`)  | yes  | no\*      | `?plainText=true`                                      |
| GET    | `/api/v4/tasks/{id}/comments`    | Comments on a task                   | yes  | no\*      |                                                        |
| GET    | `/api/v4/folders/{id}/comments`  | Comments on a folder                 | yes  | no\*      |                                                        |
| POST   | `/api/v4/tasks/{id}/comments`    | Add comment to task                  | yes  | no        |                                                        |
| POST   | `/api/v4/folders/{id}/comments`  | Add comment to folder                | yes  | no        |                                                        |
| PUT    | `/api/v4/comments/{id}`          | Edit comment                         | yes  | no        |                                                        |
| DELETE | `/api/v4/comments/{id}`          | Delete comment                       | yes  | no        |                                                        |
| GET    | `/api/v4/timelogs`               | All timelogs                         | yes  | no\*      | filters: created/tracked/me                            |
| GET    | `/api/v4/tasks/{id}/timelogs`    | Timelogs on a task                   | yes  | no\*      |                                                        |
| GET    | `/api/v4/contacts/{id}/timelogs` | Timelogs by a user                   | yes  | no\*      |                                                        |
| POST   | `/api/v4/tasks/{id}/timelogs`    | Log time on a task                   | yes  | no        |                                                        |
| PUT    | `/api/v4/timelogs/{id}`          | Edit timelog                         | yes  | no        |                                                        |
| DELETE | `/api/v4/timelogs/{id}`          | Delete timelog                       | yes  | no        |                                                        |
| GET    | `/api/v4/workflows`              | List workflows + custom statuses     | yes  | no        | Needed for `customStatusId`                            |
| GET    | `/api/v4/customfields`           | List custom field definitions        | yes  | no        |                                                        |
| POST   | `/api/v4/webhooks`               | Create account webhook               | yes  | no        | also `/folders/{id}/webhooks`, `/spaces/{id}/webhooks` |
| GET    | `/api/v4/webhooks`               | List webhooks                        | yes  | no        |                                                        |
| DELETE | `/api/v4/webhooks/{id}`          | Delete webhook                       | yes  | no        |                                                        |

\* Most list endpoints are pagination-capable via `pageSize`/`nextPageToken`; the big `/tasks` and `/folders` searches are the ones that reliably page. Smaller scoped lists usually return the full set. [INFERRED]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported? | Syntax                                           | Notes                                    |
| ------------------------------- | ---------- | ------------------------------------------------ | ---------------------------------------- |
| Filter by field value           | yes        | `?status=Active&importance=High`                 | Per-field query params                   |
| Filter by date range            | yes        | `?updatedDate={"start":"...","end":"..."}`       | URL-encoded JSON range object            |
| Full-text search                | partial    | `?title=<substring>`                             | Title contains-match, not full text      |
| Sort by field                   | yes        | `?sortField=UpdatedDate`                         | Limited set of sort fields               |
| Sort direction (asc/desc)       | yes        | `?sortOrder=Asc\|Desc`                           |                                          |
| Field selection / sparse fields | partial    | `?fields=["subTaskIds","description"]`           | OPT-IN extra fields, not trimming        |
| Include related records         | partial    | via `fields` (e.g. `subTaskIds`, `superTaskIds`) | Not generic expansion                    |
| Aggregate / count               | no         | —                                                | Use `responseSize` / count client-side   |
| Logical operators (AND/OR)      | partial    | Multiple params = AND; comma in one param = OR   | No nested boolean expressions            |
| Comparison operators (gt, lt)   | partial    | Only via date range `{start,end}`                | No generic `gt`/`lt` on arbitrary fields |
| Null checks                     | no         | —                                                |                                          |
| Regex / pattern matching        | no         | —                                                | `title` is substring only                |

### 5.2 Filter Syntax [REQUIRED]

**General pattern (query params, AND-combined):**

```
GET /api/v4/tasks?status=Active&importance=High&responsibles=[KUAAAAAA]
```

**Date-range params take a URL-encoded JSON object:**

```
GET /api/v4/tasks?updatedDate={"start":"2026-05-01T00:00:00Z","end":"2026-05-31T23:59:59Z"}
(URL-encoded: %7B%22start%22%3A...%7D)
```

**Combining filters:** multiple distinct params = logical AND. Comma-separated values within a single enum param (e.g. `status=Active,Completed`) = OR within that field. No nested boolean grouping. [DOCUMENTED]

### 5.3 Sort Syntax [IMPORTANT]

```
?sortField=UpdatedDate&sortOrder=Desc
```

Allowed `sortField` values are a fixed set (e.g. `CreatedDate`, `UpdatedDate`, `CompletedDate`, `DueDate`, `Status`, `Importance`, `Title`). One sort field at a time. [DOCUMENTED]

### 5.4 Field Selection [NICE-TO-HAVE]

```
?fields=["subTaskIds","description","superTaskIds","customFields","attachmentCount"]
```

Wrike's `fields` is **additive opt-in** for expensive optional fields — it does NOT trim the default response. The value is a URL-encoded JSON array of strings. [DOCUMENTED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** none — search is per-entity (`?title=` on tasks/folders).
- **Searchable fields:** `title` (substring). Full-text body/comment search is NOT exposed via the public API. [DOCUMENTED]
- **Fuzzy matching:** no. `title` is a literal contains-match. [INFERRED]
- **Minimum query length:** not documented. [UNKNOWN]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: My active tasks**

```http
GET /api/v4/tasks?status=Active&responsibles=[<myContactId>]&fields=["description"]&pageSize=100
```

**Pattern 2: Tasks updated since last poll (change feed)**

```http
GET /api/v4/tasks?updatedDate={"start":"2026-05-29T00:00:00Z"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000
```

**Pattern 3: Tasks in a specific project**

```http
GET /api/v4/folders/IEAAALZ4I4AAAAB/tasks?status=Active,Deferred&fields=["responsibleIds"]
```

**Pattern 4: All projects (folders carrying a project object) with status**

```http
GET /api/v4/folders?project=true&fields=["briefDescription"]
```

**Pattern 5: Recent comments on a task as plain text**

```http
GET /api/v4/tasks/IEAAALZ4KQAAAAAK/comments?plainText=true
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** cursor — `pageSize` + `nextPageToken`. [DOCUMENTED]
- **Default page size:** unbounded for small lists; capped responses for big searches. For `/tasks` and `/folders`, supply `pageSize` to opt into paging. [DOCUMENTED]
- **Maximum page size:** 1000 (tasks). [DOCUMENTED]
- **Total count available:** `responseSize` is present on some list responses (count of items in this response), but there is NO documented account-wide total without iterating. [INFERRED]

**Request parameters:**

| Parameter       | Type   | Default | Description                                                   |
| --------------- | ------ | ------- | ------------------------------------------------------------- |
| `pageSize`      | int    | —       | Items per page; max 1000 for tasks.                           |
| `nextPageToken` | string | —       | Cursor returned in the previous response. Omit on first call. |

**Response structure:**

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

**How to detect last page:** `nextPageToken` is absent/null in the final response. [DOCUMENTED]

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /api/v4/tasks?pageSize=1000
        → response includes nextPageToken="eyJ...A"

Page 2: GET /api/v4/tasks?pageSize=1000&nextPageToken=eyJ...A
        → response includes nextPageToken="eyJ...B"

Last:   GET /api/v4/tasks?pageSize=1000&nextPageToken=eyJ...B
        → no nextPageToken field → stop
```

Do not change filter params between pages while iterating a cursor — the token encodes the query context. [INFERRED]

### 6.3 Bulk Operations [IMPORTANT]

| Operation           | Endpoint                          | Max Batch Size | Notes                                  |
| ------------------- | --------------------------------- | -------------- | -------------------------------------- |
| Bulk read (by ids)  | `GET /api/v4/tasks/{id1,id2,...}` | ~100 ids (URL) | Comma-separated IDs in the path        |
| Bulk read (folders) | `GET /api/v4/folders/{id1,id2}`   | ~100 ids       | Same pattern                           |
| Bulk create         | —                                 | —              | NOT supported — one create per request |
| Bulk update         | —                                 | —              | NOT supported — one update per request |
| Bulk delete         | —                                 | —              | NOT supported — one delete per request |

> Wrike's primary "bulk" affordance is reading many entities by comma-separated IDs in the path. There is no batch-write/composite endpoint — writes are single-entity. Loop with rate-limit awareness (≤400 req/min). [DOCUMENTED — read; INFERRED — absence of bulk write]

**Partial failure handling:** N/A for single-entity writes. For multi-ID reads, missing/forbidden IDs are silently omitted from `data` (no per-ID error array). [INFERRED]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- **Data Export API:** `GET /api/v4/data_export` — full-account snapshot export (requires `dataExportFull` scope). Returns downloadable resources (CSV-style tables). Intended for full backups/analytics, not incremental. [DOCUMENTED]
- **Async:** the export is generated server-side; poll the export resource for availability. [INFERRED]
- **Out of scope for the LLM connector** — this is an admin/backup operation, not a chat action.

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                                   |
| ------------------------ | ---------- | ------------------------------------------------------- |
| Webhooks                 | yes        | Account / folder / space scoped. HMAC-signed payloads.  |
| WebSocket                | no         | Not exposed.                                            |
| Server-Sent Events (SSE) | no         |                                                         |
| Long polling             | no         |                                                         |
| Change feeds / streams   | partial    | Poll `/tasks?updatedDate={start:...}` as a change feed. |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** API. `POST /api/v4/webhooks` (account-wide), `POST /api/v4/folders/{folderId}/webhooks` (folder-scoped), `POST /api/v4/spaces/{spaceId}/webhooks` (space-scoped). [DOCUMENTED]
- **Registration body (form):** `hookUrl=https://example.com/wrike/webhook&events=[TaskCreated,TaskStatusChanged]&secret=<your-secret>`.
- **Webhook URL requirements:** HTTPS. Must complete a verification handshake on registration.
- **Verification handshake:** On create, Wrike POSTs an `X-Hook-Secret` challenge header to your `hookUrl`; you must echo the same `X-Hook-Secret` header back in a 200 response to confirm ownership. Reject the handshake if the secret contains JSON characters or exceeds 100 chars (anti-oracle guidance from Wrike). [DOCUMENTED]

**Webhook object fields:** `id`, `accountId`, `folderId`/`spaceId` (if scoped), `hookUrl`, `status` (`Active` / `Suspended`), `events[]`. [DOCUMENTED]

**Event catalog (representative — task/project/comment/timelog):**

| Event Name                | Trigger                        | Payload Summary                                                              |
| ------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `TaskCreated`             | New task                       | `taskId`, `eventAuthorId`, `lastUpdatedDate`                                 |
| `TaskDeleted`             | Task deleted                   | `taskId`                                                                     |
| `TaskTitleChanged`        | Title edited                   | `taskId`, `oldValue`, `newValue`                                             |
| `TaskImportanceChanged`   | Importance changed             | `taskId`, `oldImportance`, `newImportance`                                   |
| `TaskStatusChanged`       | Status / custom-status changed | `taskId`, `oldStatus`, `newStatus`, `oldCustomStatusId`, `newCustomStatusId` |
| `TaskDatesChanged`        | Start/due/duration changed     | `taskId`, old/new dates                                                      |
| `TaskParentsAdded`        | Added to a folder              | `taskId`, `addedParentId`                                                    |
| `TaskParentsRemoved`      | Removed from a folder          | `taskId`, `removedParentId`                                                  |
| `TaskResponsiblesAdded`   | Assignee added                 | `taskId`, `addedResponsibleId`                                               |
| `TaskResponsiblesRemoved` | Assignee removed               | `taskId`, `removedResponsibleId`                                             |
| `CommentAdded`            | Comment posted                 | `taskId`/`folderId`, `commentId`                                             |
| `AttachmentAdded`         | File attached                  | `taskId`, `attachmentId`                                                     |
| `TimelogChanged`          | Timelog added/edited/deleted   | `taskId`, `timelogId`                                                        |

(Project/folder analogues exist for created/deleted/changed.) [DOCUMENTED — set is representative; exact field names per event should be confirmed live]

**Payload format (array of events POSTed to your endpoint):**

```json
[
  {
    "taskId": "IEAAALZ4KQAAAAAK",
    "webhookId": "IEAAALZ4JEAAAAA",
    "eventAuthorId": "KUAAAAAA",
    "eventType": "TaskStatusChanged",
    "lastUpdatedDate": "2026-05-29T02:00:00Z",
    "oldStatus": "Active",
    "newStatus": "Completed",
    "oldCustomStatusId": "IEAAALZ4JMAAAAA",
    "newCustomStatusId": "IEAAALZ4JNAAAAA"
  }
]
```

**Verification / security:**

- **Signature header:** `X-Hook-Signature` on every delivered event. [DOCUMENTED]
- **Signature algorithm:** `HMAC-SHA256(key = your secret, value = raw request body)`, hex-encoded — compare against `X-Hook-Signature`. [DOCUMENTED]
- **Handshake header:** `X-Hook-Secret` (echo-back on registration). [DOCUMENTED]
- **IP allowlist:** not documented. [UNKNOWN]

**Reliability:**

- **Retry policy:** Wrike retries failed deliveries; after sustained failures the webhook is auto-**Suspended** (status flips to `Suspended`) and must be re-enabled. [DOCUMENTED]
- **Dead letter:** none — events are dropped once suspended.
- **Event ordering:** best-effort; not guaranteed.
- **Duplicate delivery:** possible (on retry) — dedupe on `(eventType, taskId, lastUpdatedDate)`.

### 7.3 WebSocket / SSE [NICE-TO-HAVE]

Not applicable. [DOCUMENTED — absence]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended endpoint:** `GET /api/v4/tasks?updatedDate={"start":"<last_poll_iso>"}&sortField=UpdatedDate&sortOrder=Desc&pageSize=1000`.
- **Interval:** 5–15 minutes is safe within the 400 req/min budget; never sub-minute for a busy account.
- **"Modified since" filter:** yes — `updatedDate` range. [DOCUMENTED]
- **Change-detection field:** `updatedDate` (always server-set). [DOCUMENTED]
- **Rate-limit implications:** each poll page is 1 request against the 400/min/user budget.

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope                       | Limit         | Window   | Notes                                                                                                  |
| --------------------------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Per access token / per user | 400 requests  | 1 minute | Primary limit for an integration. [DOCUMENTED]                                                         |
| Per IP                      | 5000 requests | 1 minute | Aggregate across users behind one IP.                                                                  |
| DDoS guard                  | dynamic       | —        | Wrike may 429 a too-expensive request even under the stated limit; contact Support if so. [DOCUMENTED] |

- **Rate limit headers:** none documented as reliably returned (no `X-RateLimit-Remaining` guarantee). You learn the limit by getting a 429. [INFERRED]

| Header        | Meaning                        | Example Value |
| ------------- | ------------------------------ | ------------- |
| `Retry-After` | Seconds to wait (when present) | `30`          |

- **Rate-limit exceeded response:**

```json
{
  "error": "rate_limit_exceeded",
  "errorDescription": "IP or access token exceeded limit: 400 requests per minute"
}
```

(HTTP 429; `error` may also be `too_many_requests`.) [DOCUMENTED]

- **Retry-After header:** sometimes present.
- **Backoff strategy:** exponential with jitter, base 2s, cap 60s; honour `Retry-After` when present. [DOCUMENTED — Wrike explicitly recommends exponential backoff]

### 8.2 Error Handling [REQUIRED]

**Standard error response format:**

```json
{
  "error": "invalid_parameter",
  "errorDescription": "Request parameter name or value is invalid"
}
```

**Error codes reference:**

| HTTP Status | Error Code                                  | Meaning                                           | Retryable? | Recovery Action                              |
| ----------- | ------------------------------------------- | ------------------------------------------------- | ---------- | -------------------------------------------- |
| 400         | `invalid_request`                           | HTTP type invalid; critical data absent/malformed | No         | Fix request shape                            |
| 400         | `invalid_parameter`                         | Param name or value invalid                       | No         | Fix the param                                |
| 400         | `parameter_required`                        | Required param missing                            | No         | Supply the param                             |
| 401         | `not_authorized`                            | Token invalid / malformed / expired               | Yes        | Refresh token; if refresh fails → re-consent |
| 403         | `access_forbidden`                          | Access to entity denied for this user             | No         | Check sharing / permissions                  |
| 403         | `not_allowed`                               | Action blocked by license/quota limitation        | No         | Check plan / scope (`wsReadOnly`→write)      |
| 404         | `resource_not_found`                        | Entity not found                                  | No         | Verify ID                                    |
| 404         | `method_not_found`                          | API method doesn't exist                          | No         | Verify path                                  |
| 429         | `too_many_requests` / `rate_limit_exceeded` | >400 req/min (token/user) or >5000/min (IP)       | Yes        | Backoff + retry                              |
| 500         | `server_error`                              | Server-side error                                 | Yes        | Retry with backoff                           |
| 502/503     | (gateway)                                   | Edge / maintenance                                | Yes        | Retry after Retry-After                      |

**Validation error format:** Wrike uses the same flat `{error, errorDescription}` shape for validation failures — there is NO per-field `details` array (unlike Zoho). The `errorDescription` string names the offending parameter. [DOCUMENTED]

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** no dedicated header. [DOCUMENTED — absence]
- **Natural idempotency:** GET is idempotent; PUT-by-id is idempotent; DELETE-by-id is idempotent (second delete → 404 / no-op). POST create is NOT idempotent — retrying creates a duplicate task/comment/timelog.
- **Recommendation:** for retry-prone create flows, the agent should first search by `title` (or check the prior response) before re-POSTing to avoid duplicates. [INFERRED]

### 8.4 Async Operations [IMPORTANT]

- The only async surface is the **Data Export API** (full-account export) — kick off, then poll the export resource. [INFERRED]
- Core CRUD is fully synchronous. [DOCUMENTED]

### 8.5 File Handling [IMPORTANT]

- **Upload endpoint:** `POST /api/v4/folders/{folderId}/attachments` and `POST /api/v4/tasks/{taskId}/attachments` — binary body with `X-File-Name` header (NOT multipart in the common case). [DOCUMENTED]
- **Max file size:** plan-dependent (free tiers smaller); not a single fixed number. [UNKNOWN — confirm against plan]
- **Allowed types:** any. [INFERRED]
- **Download endpoint:** `GET /api/v4/attachments/{attachmentId}/download` (or `/preview`). Returns raw bytes. [DOCUMENTED]
- **Note:** attachment up/download is OUT OF SCOPE for v1 of the Numa connector — `connect_request` does JSON, not binary streaming. Flagged in §9.3.

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** none documented (no ETag / version field on writes) — last-write-wins. Use `updatedDate` to detect concurrent edits client-side. [INFERRED]
- **Conflict resolution:** caller's responsibility.
- **Consistency:** writes are immediately readable on the same host. [INFERRED]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                            | Fits?   | Notes                                                       |
| -------------------------- | ------------------------------------------------------ | ------- | ----------------------------------------------------------- |
| **Data Connector**         | API has file-like content to browse/search/download    | no      | Wrike is structured work items, not a file tree             |
| **Data Connector (Files)** | API is primarily a file storage/document system        | no      | Attachments exist but are secondary; not the product's core |
| **Direct API Only**        | API is action-oriented (no browsable content)          | **yes** | LLM calls via `connect_request`; no Files > Remote UI       |
| **Hybrid**                 | API has both browsable content AND action capabilities | no      | Attachments don't warrant a file-browser surface in v1      |

**Selected integration path:** **Direct API Only** (matches the registry — no `surfaces: ['files']`, this is a chat/action connector).

**Justification:** Wrike is a structured work-management platform — tasks, folders/projects, comments, timelogs, contacts. These are not meaningfully a browsable file tree, so the Data Connector (Files) path does not fit. All interaction happens through the workspace agent's `connect_request` tool, with `01-llm-api-rules.md` as the agent's mental model. The connector is read-only as currently configured (`scopes: 'wsReadOnly'`); enabling create/update/comment/timelog actions requires widening the registry scope to `Default,wsReadWrite`.

### 9.2 Connector Requirements [IMPORTANT]

Wrike v4 is a fully documented public REST API — any HTTP client that can perform OAuth 2.0 Authorization Code and inject `Authorization: Bearer {token}` can drive the API surface. No special SDK or provider class is required.

Requirements for any integrator:

1. OAuth client (`client_id` / `client_secret`) registered in the Wrike Developer Portal (Apps & Integrations), with the Numa redirect URI. Auth host is the single global `login.wrike.com` (not region-pinned).
2. **Read `host` from the token response and build the API base URL as `https://<host>/api/v4` — do NOT hardcode `www.wrike.com`** (EU accounts return `app-eu.wrike.com` etc.). This is the dominant Wrike-specific gotcha.
3. Persist the **rotated** `refresh_token` on every refresh (Wrike invalidates the old pair on each refresh) — failing to do so loses access.
4. Scope: registry currently `wsReadOnly` (read). Widen to `Default,wsReadWrite` for write actions.

> Numa-internal wiring (vault keys, registry entries, commit refs) lives in the connector skill / Numa-side docs — not part of the Wrike API surface and not documented here.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. List / search / get tasks, folders, projects, comments, timelogs, contacts (read — works under `wsReadOnly`).
2. Filter tasks by status/importance/assignee/date-range and sort; paginate via `nextPageToken`.
3. Resolve "me" via `GET /contacts?me=true` and answer "my tasks" queries.
4. (with `wsReadWrite`) Create tasks under a folder; update task title/status/dates/assignees; post comments; log time.
5. Discover valid workflow custom statuses via `/workflows` before setting `customStatusId`.

**CANNOT do (out of scope or dangerous for v1):**

1. Upload / download attachments — `connect_request` handles JSON, not binary streams.
2. Full-account Data Export (`dataExportFull`) — admin/backup op, not a chat action.
3. Register webhooks on the user's behalf — needs a Numa-hosted public endpoint + X-Hook-Secret handshake + HMAC verification.
4. Bulk writes — Wrike has no batch-write endpoint; the agent must loop and respect the 400 req/min budget (avoid runaway loops).
5. Delete folders/tasks without explicit user confirmation — soft-delete to Recycle Bin, but still destructive.

**Default parameters:**

| Parameter               | Default                | Reason                                                       |
| ----------------------- | ---------------------- | ------------------------------------------------------------ |
| `pageSize`              | 1000 (tasks)           | API max — minimise round-trips against the 400/min budget.   |
| `sortField`/`sortOrder` | `UpdatedDate` / `Desc` | Freshest-first matches user expectation.                     |
| `plainText` (comments)  | `true`                 | LLM wants plain text, not HTML.                              |
| `fields` (tasks)        | omit unless needed     | Extra fields are expensive opt-ins; only request when asked. |
| base URL host           | from token `host`      | NEVER hardcode `www.wrike.com`.                              |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK                | Language | Quality | Maintained? | Worth Using? | Notes                                              |
| ------------------ | -------- | ------- | ----------- | ------------ | -------------------------------------------------- |
| community wrappers | Python   | varied  | community   | No           | Numa uses raw httpx via `connect_request`.         |
| community wrappers | Node     | varied  | community   | No           | Same — no maintained first-party SDK to depend on. |

No first-party, current SDK exists, and adding one would break the framework rule "all connectors are the same from the framework perspective". Raw REST is the right call.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 complete: **auth working and first call documented** — BLOCKED, no test OAuth client during desk research
- [x] Phase 3 complete: core entities (Folder/Project, Task, Comment, Timelog, Contact) with fields documented
- [x] Phase 4 complete: 10+ critical endpoints documented with request/response
- [x] Phase 5 complete: query and filter patterns documented
- [x] Phase 6 complete: pagination model (`pageSize`/`nextPageToken`) documented with worked example
- [x] Phase 7 complete: Webhooks API (HMAC + handshake) + polling fallback documented
- [x] Phase 8 complete: rate limits, error model, idempotency documented
- [x] Phase 9 complete: integration path = Direct API Only

**Overall investigation confidence:** medium

**Known gaps that will reduce output quality:**

1. Phase 2 live-gate NOT satisfied — downstream files carry [DOCUMENTED] markers until an engineer promotes them to [CONFIRMED] via a live `GET /api/v4/contacts?me=true` after the first admin install. The token-`host` resolution in particular MUST be verified live (esp. for an EU-resident test account).
2. Registry scope is `wsReadOnly` — all write capabilities (create task, comment, timelog) are documented as available BUT gated off until the scope is widened to `Default,wsReadWrite`. The 01c mutation-patterns doc should note this explicitly.
3. Webhook event field names per event type are representative, not exhaustively verified — confirm against a live webhook delivery before relying on specific old/new value field names.
4. Bulk write absence and the rotating-refresh-token behaviour are correctness-critical and must be carried prominently into 01-llm-api-rules and 01d.

### 10.2 Generation Prompts [REQUIRED]

Generating from this questionnaire:

1. 01-llm-api-rules.md — main prompt, <300 lines. MUST headline: (a) read `host` from token, (b) `Bearer` auth, (c) rotating refresh token, (d) 400 req/min, (e) no bulk writes, (f) read-only until scope widened.
2. 01a-domain-model-reference.md — Folder/Project, Task, Comment, Timelog, Contact + the N:M task↔folder relationship.
3. 01b-query-patterns.md — task/folder filters, date-range JSON params, `pageSize`/`nextPageToken` pagination.
4. 01c-mutation-patterns.md — create task / update task (add/remove deltas) / comment / timelog; flag `wsReadWrite` requirement.
5. 01d-event-and-error-handling.md — Webhooks (handshake + HMAC + suspension), error model, rate limits, exponential backoff.
6. 02-api-spec-investigation.md — dev-facing condensed reference.
7. ~~03-connector-setup.md~~ — **SKIP** (integration path is Direct API Only, not Data Connector).
8. 04-connection-and-reauth.md — OAuth app creation, the token-`host` mechanic, rotating refresh-token handling, scope widening.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                                         |
| ---------------------------- | ------------- | ---------- | ---------------------------------------------------------------------------- |
| 01-llm-api-rules             | yes           | medium     | Phase 2 gate not satisfied; host resolution unverified live                  |
| 01a-domain-model-reference   | yes           | medium     | Some optional fields / project sub-fields confirmed only from docs           |
| 01b-query-patterns           | yes           | medium     | Date-range JSON encoding not exercised live                                  |
| 01c-mutation-patterns        | yes           | medium     | Writes gated behind scope widen; add/remove delta syntax doc-only            |
| 01d-event-and-error-handling | yes           | medium     | Per-event webhook field names representative, not exhaustively verified      |
| 02-api-spec-investigation    | yes           | medium     |                                                                              |
| 03-connector-setup           | n/a           | —          | Skipped — Direct API Only path                                               |
| 04-connection-and-reauth     | yes           | medium     | Token-`host` + rotating-refresh behaviour must be confirmed on first install |

---

_Investigation blocked on first-live-call gate. Downstream output proceeds at [DOCUMENTED] confidence; a follow-up `live-verification.md` or an update to this questionnaire should run after the first successful `GET /api/v4/contacts?me=true` against a Wrike OAuth app — verifying in particular the token-response `host` resolution and the rotating refresh-token flow._

_Sources: [developers.wrike.com/overview](https://developers.wrike.com/overview/), [OAuth 2.0 Authorization](https://developers.wrike.com/oauth-20-authorization/), [Tasks](https://developers.wrike.com/api/v4/tasks/), [Folders & Projects](https://developers.wrike.com/api/v4/folders-projects/), [Comments](https://developers.wrike.com/api/v4/comments/), [Timelogs](https://developers.wrike.com/api/v4/timelogs/), [Contacts](https://developers.wrike.com/api/v4/contacts/), [Errors](https://developers.wrike.com/errors/), [Webhooks](https://developers.wrike.com/webhooks/)._
