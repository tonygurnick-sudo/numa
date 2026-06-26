---
api_name: 'Motion'
api_slug: 'motion'
vendor: 'Motion (usemotion.com)'
website: 'https://www.usemotion.com'
investigation_started: '2026-06-26'
investigation_updated: '2026-06-26'
investigator: 'Claude Code (automated) — documentation review only, no live API test'
investigation_status: 'complete'
documentation_quality: 'good'
api_types: ['REST']
overall_confidence: 'medium — DOCUMENTED from docs.usemotion.com, not live-tested'
blockers: []
---

# API Investigation Questionnaire: Motion

> Completed by automated investigation on 2026-06-26 from the official Motion developer docs (docs.usemotion.com — api-reference, getting-started cookbook, rate-limits cookbook).
> No live API call was made — every answer is marked `[DOCUMENTED]`, `[INFERRED]`, or `[UNKNOWN]`. Nothing is `[CONFIRMED]`.
>
> **Headline facts:** Base URL `https://api.usemotion.com/v1`; auth is a **per-user static API key in the `X-API-Key` header** (NOT Bearer); health check `GET /users/me`; **rate limit 12 req/min individual, 120 team, with NO documented `Retry-After`** — the dominant operational concern.
>
> Sources: docs.usemotion.com — `/api-reference`, `/cookbooks/getting-started/`, `/cookbooks/rate-limits/`, and the per-resource reference pages (tasks, projects, workspaces, schedules, recurring-tasks, comments, statuses, custom-fields, users).

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://docs.usemotion.com/ [DOCUMENTED]
- **API reference / endpoint catalog URL:** https://docs.usemotion.com/api-reference/ [DOCUMENTED]
- **Getting started / auth guide URL:** https://docs.usemotion.com/cookbooks/getting-started/ [DOCUMENTED]
- **Rate-limits guide URL:** https://docs.usemotion.com/cookbooks/rate-limits/ [DOCUMENTED]
- **Changelog / status page URL:** Not discovered [UNKNOWN]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** No single downloadable spec located [UNKNOWN]; the interactive api-reference is the authoritative source.
- **Postman collection URL:** Not discovered [UNKNOWN]
- **Official SDKs:** None official located [UNKNOWN].
- **Community:** Not surveyed [UNKNOWN].

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                          |
| ------------------------- | ------ | ------------------------------------------------------------------------------ |
| Authentication            | 5      | `X-API-Key` header clearly documented with a curl example                      |
| Endpoint reference        | 4      | Per-resource pages for all resources; some response schemas partial            |
| Request/response examples | 4      | Most endpoints show JSON examples; a few only partial field sets               |
| Error documentation       | 2      | No comprehensive status-code table found; error body shape not fully published |
| Rate limit documentation  | 4      | Explicit individual/team per-minute limits; **no `Retry-After` documented**    |
| Pagination documentation  | 4      | Cursor-based via `meta.nextCursor`/`pageSize`; no total count                  |
| Webhook documentation     | 1      | No webhooks documented in the public API                                       |
| SDKs / code examples      | 2      | curl snippets only; no official language SDKs found                            |
| Changelog / versioning    | 3      | Core API is `v1`; Custom Fields on a separate `/beta` path                     |

**Overall documentation quality:** good

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Confirmed no single OpenAPI/Swagger download (interactive reference only)
- [x] Identified authentication method (`X-API-Key` header — per-user key)
- [x] Found at least one working example (curl `GET /v1/workspaces` from docs; not executed here)
- [x] Identified rate limit information (12/min individual, 120 team; no `Retry-After`)
- [x] Identified pagination approach (cursor via `meta.nextCursor`)
- [x] Checked for webhook/event support (none documented)
- [x] Checked for official SDKs (none found)
- [ ] **Live API testing — NOT performed.** All answers are documentation-based.

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Motion API [DOCUMENTED]
- **Vendor / company:** Motion (usemotion.com) — AI calendar / task & project management [DOCUMENTED]
- **Current API version:** Core API `v1` (in the base URL). Custom Fields on a separate `/beta` path. [DOCUMENTED]
- **Base URL(s):**
  - Production: `https://api.usemotion.com/v1` [DOCUMENTED]
  - Custom Fields (beta): `https://api.usemotion.com/beta/...` [DOCUMENTED]
  - Sandbox: None documented [UNKNOWN]
- **API type:** REST (JSON over HTTPS) [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS [INFERRED]
- **Data format:** JSON [DOCUMENTED]
- **Content-Type:** `application/json`; send `Accept: application/json` [DOCUMENTED]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure:** `https://api.usemotion.com/v1/{resource}` — e.g. `/tasks`, `/projects`, `/workspaces`, `/users/me`. The **`/v1` is in the base URL** — paths must not repeat it. Custom Fields break the pattern: `/beta/workspaces/{workspaceId}/custom-fields`. [DOCUMENTED]
- **Versioning strategy:** Version in URL (`/v1`); a separate `/beta` namespace for newer surfaces. [DOCUMENTED]
- **Field casing:** camelCase (`workspaceId`, `dueDate`, `createdTime`, `assigneeId`, `isDefaultStatus`) [DOCUMENTED]
- **ID format:** **Opaque strings everywhere** (`task_789`, `proj_xyz789`, `ws_123`, `user_456`). Never coerce/parse. [DOCUMENTED]
- **Timestamps:** **ISO-8601 datetime strings** (`2024-01-15T17:00:00Z`) — NOT epoch seconds. [DOCUMENTED]
- **Required headers (all requests):**

| Header       | Value              | Purpose                                             |
| ------------ | ------------------ | --------------------------------------------------- |
| X-API-Key    | `{api_token}`      | Per-user secret API key — **this connector's auth** |
| Accept       | `application/json` | Response format                                     |
| Content-Type | `application/json` | Request body format (POST/PATCH)                    |

### 2.3 Authentication [REQUIRED]

- **Auth method:** Static **API key** (per user) [DOCUMENTED]
- **Auth location:** HTTP request **header** [DOCUMENTED]
- **Auth header format:**

```
X-API-Key: {api_token}
```

(NOT `Authorization: Bearer …` — Motion authenticates only with `X-API-Key`. Docs: "Pass in your API key as a X-API-Key header.")

- **How to obtain:** Motion web app → **Settings → API** → "create an API key". The key is **shown only once** ("Be sure to copy the key, as it will only be shown once") — capture immediately. [DOCUMENTED]
- **Scope:** Per **user** — the key carries that user's own Motion permissions. No separate OAuth-style scope model. [DOCUMENTED]
- **Key format:** Opaque secret string; treat as a password — never log/echo. [DOCUMENTED]
- **Token lifetime:** No documented expiry — static, indefinite. [INFERRED]
- **Refresh mechanism:** None — no exchange, no refresh, no `expires_in`. [DOCUMENTED]
- **Rotation:** Manual — create a new key in Settings → API, delete the old. No programmatic key-management endpoint located. [INFERRED]
- **Rate limits:** Per **account** (not per key): individual **12/min**, team **120/min**, enterprise higher. [DOCUMENTED]
- **Registry config check:** Proposed `connectorRegistry.ts` entry `motion` with `authType: 'api-key'`, single credential field `api_token` (password, required), `baseUrl: 'https://api.usemotion.com/v1'`, and `credentialHeaderMap: { 'X-API-Key': 'api_token' }`. No base/instance URL field beyond the fixed host. [DOCUMENTED — see 03]

> Implication for Numa: a materially simple connector — no token exchange, no refresh, no expiry handling. The relay attaches `X-API-Key` and forwards. The **only** non-trivial behaviour is the rate-limit discipline (Phase 8).

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> ⚠️ **GATE NOT PASSED — no live call was made.** The request/response below is the canonical example from the official docs, reproduced for reference, NOT executed against the live API.

**Endpoint documented for the health check:**

```http
GET /v1/users/me HTTP/1.1
Host: api.usemotion.com
Accept: application/json
X-API-Key: {api_token}
```

**Expected response (shape per docs, illustrative):** [DOCUMENTED — shape only]

```json
{ "id": "user_456", "name": "Jane Doe", "email": "jane@acme.com" }
```

The docs' own first example is `GET /v1/workspaces` (`curl -H "X-API-Key: YOUR_API_KEY" https://api.usemotion.com/v1/workspaces`), which is also the natural first real-data call since everything is workspace-scoped.

- **HTTP status code:** Expected `200` [INFERRED]
- **Response headers of note:** None documented for rate limiting (no `Retry-After`, no documented `x-ratelimit-*` headers) [UNKNOWN]
- **Gotchas:** The `/v1` is already in the base URL (don't double it); the key is per-user (a 403 = no access, not a bad key); Custom Fields are on `/beta`. [DOCUMENTED]

- [ ] **GATE CHECK: NOT completed — documentation-only investigation. Live `GET /users/me` call required to confirm auth + envelope.**

---

## Phase 3: Domain Model & Behavior

> Full entity catalog with field tables, relationships, and business rules is in `01a-domain-model-reference.md`; a condensed model summary is in `02-api-spec-investigation.md`. Summarised here.

### 3.1 Core Entities [REQUIRED]

| Entity         | Paths                                                               | CRUD support                                                   |
| -------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Task           | `/tasks`, `/tasks/{id}`, `/tasks/{id}/move`, `/tasks/{id}/unassign` | Create, Read (list+id), Update (PATCH), Delete, Move, Unassign |
| Project        | `/projects`, `/projects/{id}`                                       | Create, Read (list+id). **No update/delete.**                  |
| Workspace      | `/workspaces`                                                       | Read (list). Top-level scoping entity.                         |
| Status         | `/statuses?workspaceId=…`                                           | Read (array). Per-workspace.                                   |
| Schedule       | `/schedules`                                                        | Read (array). Caller's working hours.                          |
| Recurring Task | `/recurring-tasks`, `/recurring-tasks/{id}`                         | Create, Read (list), Delete. **No get-by-id/update.**          |
| Comment        | `/comments?taskId=…`, `/comments`                                   | Create, Read (list). **No update/delete.**                     |
| Custom Field   | `/beta/workspaces/{workspaceId}/custom-fields[/{id}]`               | Create, Read (list), Delete. **`/beta`, not `/v1`.**           |
| User           | `/users/me`, `/users?workspaceId=…`                                 | Read (caller + list).                                          |

**Key Task fields:** `id`, `name` (req), `workspaceId` (req), `description` (GFM in/HTML out), `priority` (ASAP/HIGH/MEDIUM/LOW), `status` (string write / object read), `dueDate` (ISO-8601), `duration` (`NONE`/`REMINDER`/int min), `autoScheduled`, `projectId`, `labels`, `assigneeId`/`assignees`, `completed`, `createdTime`, `updatedTime`. Full tables in `01a`. [DOCUMENTED]

### 3.2 Relationships [REQUIRED]

Workspace (1:N) → Project (1:N) → Task (1:N) → Comment. Tasks/projects reference Users via assignees. Statuses/RecurringTasks/Users-list/CustomFields are workspace-scoped. Schedules are caller-scoped. ERD in `01a`. [INFERRED from path nesting + foreign keys; no published ERD]

### 3.3 State / Business Rules [REQUIRED]

- Everything is scoped by `workspaceId` — list `/workspaces` first.
- `status` is a string on write, an object on read; the name must exist in the workspace's `statuses[]`.
- Scheduled tasks (`autoScheduled` set) require a `dueDate`.
- `duration` is a constrained union (`NONE`/`REMINDER`/int minutes).
- No project update/delete, no recurring-task update/get-by-id, no comment edit/delete.
- Update requires `name`+`workspaceId` even for a single-field PATCH.
  [DOCUMENTED]

---

## Phase 4: Read Operations

> Full detail in `01b-query-patterns.md`.

- **Pagination:** cursor-based — `{ meta: { nextCursor, pageSize }, <resource>: [...] }`. Repeat with `?cursor=…`; null `nextCursor` = last page. No total count. `/statuses` & `/schedules` are bare arrays (not paginated). [DOCUMENTED]
- **Filtering:** per-endpoint whitelisted query params. Tasks: `workspaceId`, `assigneeId`, `projectId`, `status[]`, `includeAllStatuses`, `label`, `name` (case-insensitive substring), `cursor`. `status` ⊕ `includeAllStatuses` mutually exclusive. [DOCUMENTED]
- **Sorting:** none documented [INFERRED].
- **Field selection / include:** none [INFERRED].
- **Search:** no global search; task `name` substring is the only text filter. [DOCUMENTED]

---

## Phase 5: Write Operations

> Full detail in `01c-mutation-patterns.md`.

- Create task (`POST /tasks`, name+workspaceId), Update (`PATCH /tasks/{id}`, name+workspaceId still required), Delete, Move (`POST /tasks/{id}/move`, `{workspaceId, assigneeId?}` — POST per index, PATCH on one page), Unassign (`POST /tasks/{id}/unassign`, no body). [DOCUMENTED]
- Create project (`POST /projects`, name+workspaceId; **no update/delete**). [DOCUMENTED]
- Create/Delete recurring task; Create comment (`{taskId, content}`, content HTML; **no edit/delete**). [DOCUMENTED]
- Create/Delete custom field on `/beta`. [DOCUMENTED]
- **No idempotency keys documented** — create endpoints are non-idempotent; verify with a GET, don't blind-retry. [UNKNOWN]
- `description` casing differs: tasks GFM markdown, projects/comments HTML. [DOCUMENTED]

---

## Phase 6: Events & Webhooks

- **Webhooks: none documented** in the public API. [DOCUMENTED]
- **No WebSocket / SSE / change-feed.** [INFERRED]
- **Change detection = polling** a scoped, filtered list endpoint on a generous interval (respecting the rate budget). No "modified since" filter exists — diff full filtered result sets keyed by `id`, inspect `updatedTime`. [DOCUMENTED — absence of webhooks; polling is INFERRED best practice]

---

## Phase 7: Errors

> Full playbook in `01d-event-and-error-handling.md`.

- **Error body shape:** JSON; exact fields not fully published [UNKNOWN] — assume at least a `message`.
- **Status codes:** 400 (bad params, incl. `status`+`includeAllStatuses` together), 401 (bad/revoked key — no refresh), 403 (per-user no access), 404 (bad id / doubled `/v1`), 405 (move POST/PATCH mismatch), **429 (rate limit — NO `Retry-After`)**, 5xx. [DOCUMENTED status meanings; bodies INFERRED]

---

## Phase 8: Rate Limits & Performance ⚠️ (the defining constraint)

### 8.1 Rate limits [REQUIRED]

| Account type | Per minute | Notes                                                      |
| ------------ | ---------- | ---------------------------------------------------------- |
| Individual   | **12**     | "The base tier for individuals is 12 requests per minute." |
| Team         | **120**    | "Teams can request up to 120 requests per minute."         |
| Enterprise   | higher     | "sign up for our enterprise tier"                          |

- **Scope:** per account. [DOCUMENTED]
- **On exceed:** HTTP 429. **No documented `Retry-After`.** [DOCUMENTED — absence]
- **Strategy (THE #1 GOTCHA):** serialize all calls, pace proactively (individual ≈ 1 call / 5 s), exponential backoff + jitter on 429 (cap ~60 s, ≤5 tries), cache stable reads (`/workspaces`, `/statuses`, `/schedules`), prefer one filtered call to many. [INFERRED best practice from the documented limits]

### 8.2 Performance [IMPORTANT]

- No async/bulk export. Large reads are slow by design under the rate cap — scope and filter hard. [DOCUMENTED absence + INFERRED]

---

## Phase 9: Integration Path

- **Decision:** **Direct API Only** (chat-only, via `connect_request`). Motion exposes **records** (tasks/projects/workspaces/comments), not browsable files — **not** a Data Connector (Files) path. No `OAuthProvider` class needed. [DOCUMENTED — see 03]
- **Auth type for Numa:** `api-key`, single `api_token` field, `credentialHeaderMap: { 'X-API-Key': 'api_token' }`, fixed `baseUrl`. [DOCUMENTED]
- **Credential ownership:** **per user** — each user supplies their own key; no admin-supplied shared secret. [DOCUMENTED]

---

## Phase 10: Readiness Checklist

- [x] Auth method + header confirmed from docs (`X-API-Key`, per-user, shown once)
- [x] Base URL confirmed (`https://api.usemotion.com/v1`; `/beta` for custom fields)
- [x] Health check identified (`GET /users/me`)
- [x] Full endpoint catalog captured (tasks, projects, workspaces, statuses, schedules, recurring-tasks, comments, custom-fields, users)
- [x] Pagination model captured (cursor / `meta.nextCursor`)
- [x] Rate limits captured (12/120 per min, no `Retry-After`) + backoff strategy documented
- [x] Webhooks checked (none) → polling fallback documented
- [x] Integration path decided (Direct API, api-key, per-user)
- [x] Downstream docs authored (`01`, `01a`–`01d`, `02`, `03`, `04`)
- [ ] **Live `GET /users/me` smoke test — PENDING** (Phase 2.4 gate not passed)
- [ ] Live-verify the open questions in `02` (error body shape, `autoScheduled`/`frequency` schemas, custom-field association sub-paths, move verb)

---

## Appendix: Open Questions (verify live)

- Live `GET /users/me` (the critical gate).
- Exact error body shape and any rate-limit response headers.
- `autoScheduled` object sub-fields; recurring-task `frequency` schema.
- Custom-field **association** sub-paths (set/clear value on a project/task).
- Whether `move` is canonically POST or PATCH.
- Whether keys ever expire / any documented rotation endpoint.
