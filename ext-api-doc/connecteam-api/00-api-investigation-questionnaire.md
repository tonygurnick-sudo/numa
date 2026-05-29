---
api_name: 'Connecteam (API Key)'
api_slug: 'connecteam-api'
vendor: 'Connecteam'
website: 'https://connecteam.com'
investigation_started: '2026-05-29'
investigation_updated: '2026-05-29'
investigator: 'Claude Code (automated) — documentation review only, no live API test'
investigation_status: 'complete'
documentation_quality: 'good'
api_types: ['REST']
overall_confidence: 'medium — DOCUMENTED, not live-tested'
blockers: []
---

# API Investigation Questionnaire: Connecteam (API Key)

> Completed by automated investigation on 2026-05-29 from official Connecteam developer docs (developer.connecteam.com) and Help Center.
> No live API call was made — every answer is marked `[DOCUMENTED]`, `[INFERRED]`, or `[UNKNOWN]`. Nothing is `[CONFIRMED]`.
>
> **This connector is the SAME underlying API as `connecteam-oauth`.** The domain, entities, endpoints, pagination, rate limits, query/mutation behaviour, errors, and webhooks are identical. **The ONLY substantive difference is authentication:** this connector uses a static account-level **API key in the `X-API-KEY` header**, whereas `connecteam-oauth` exchanges Client ID/Secret for a short-lived bearer token via the OAuth client-credentials flow. That difference is fully reflected in Phase 2.3 below and in the auth-related downstream docs (01 auth section, 04 endpoint auth). Everything else should be mirrored from / kept identical to the `connecteam-oauth` package.
>
> Sources: developer.connecteam.com (`/llms.txt`, `/docs/authentication-1`, `/docs/pagination-1`, `/docs/rate-limiting-1`, `/docs/introduction-1`, `/docs/read-users-data`, `/docs/get-jobs`, `/docs/time-clock-time-activities`, `/docs/scheduler-get-shifts`, `/docs/setting-up-webhook-via-api`, `/docs/oauth-20`), help.connecteam.com Forms/Jobs API articles.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://developer.connecteam.com/ [DOCUMENTED]
- **API reference / endpoint catalog URL:** https://developer.connecteam.com/reference/ (interactive reference, "authoritative source, updated in real-time with production") [DOCUMENTED]
- **Authentication guide URL:** https://developer.connecteam.com/docs/authentication-1 [DOCUMENTED]
- **Changelog / release notes URL:** https://developer.connecteam.com/changelog/ [DOCUMENTED]
- **Status page URL:** Not discovered [UNKNOWN]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** No single downloadable spec found, but `https://developer.connecteam.com/llms.txt` is an LLM-friendly Markdown index that enumerates every OpenAPI endpoint and doc page. [DOCUMENTED]
- **Postman collection URL:** Not discovered [UNKNOWN]
- **Official SDK repositories:**
  - Python: None official [UNKNOWN]
  - Node.js: None official [UNKNOWN]
  - Other: Official **MCP server** documented at `/docs/mcp` for AI agents; third-party listings exist (Composio, Make `connecteam-s14vi2`). [DOCUMENTED]
- **Official blog / engineering blog:** Not relevant for API [UNKNOWN]
- **Community forums / Stack Overflow tag:** Connecteam developer community/discussions at https://developer.connecteam.com/discuss/ [DOCUMENTED]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                       |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Authentication            | 5      | API-key (`X-API-KEY`) and OAuth both clearly documented with curl examples                  |
| Endpoint reference        | 5      | Full per-feature reference; `/llms.txt` lists ~110 endpoints across 18 feature areas        |
| Request/response examples | 4      | Most endpoints have JSON examples; some only show partial field sets                        |
| Error documentation       | 2      | Standard error shape uses a `detail` field; no comprehensive status-code table in docs      |
| Rate limit documentation  | 5      | Explicit per-plan minute + day limits, six `x-ratelimit-*` headers documented               |
| Pagination documentation  | 4      | offset/limit clearly documented; "fewer items than limit = last page"; no total-count field |
| Webhook documentation     | 4      | Webhook CRUD API + per-feature event catalog documented; payload/signature detail thin      |
| SDKs / code examples      | 3      | No official language SDKs; MCP server + code-snippet page only                              |
| Changelog / versioning    | 4      | Active changelog; per-resource path versioning (`/v1/`, `/v2/` for scheduler shifts)        |

**Overall documentation quality:** good

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed no OpenAPI/Swagger spec (no single download; `llms.txt` index exists)
- [x] Identified authentication method (`X-API-KEY` header — this connector)
- [x] Found at least one working example (curl `GET /me` from docs; not executed here)
- [x] Identified rate limit information
- [x] Identified pagination approach
- [x] Checked for webhook/event support
- [x] Checked for official SDKs (none; MCP server only)
- [ ] **Live API testing — NOT performed.** All answers are documentation-based.

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Connecteam API [DOCUMENTED]
- **Vendor / company:** Connecteam (employee management / deskless workforce platform) [DOCUMENTED]
- **Current API version:** Per-resource path versioning. Most resources are `v1`; scheduler shifts have both `v1` and `v2`. [DOCUMENTED]
- **Base URL(s):**
  - Production: `https://api.connecteam.com` [DOCUMENTED]
  - Sandbox / testing: None documented [UNKNOWN]
- **API type:** REST (JSON over HTTPS) [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1) [INFERRED]
- **Data format:** JSON [DOCUMENTED]
- **Content-Type header(s):** `application/json`; clients should send `Accept: application/json` [DOCUMENTED]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:** `https://api.connecteam.com/{feature}/{version}/{resource}` — e.g. `/users/v1/users`, `/time_clock/v1/time_clocks/{id}/time_activities`, `/scheduler/v2/schedulers/{id}/shifts`. Note the special unprefixed `/me`. [DOCUMENTED]
- **Versioning strategy:** Version in URL path, scoped per feature (`/v1/`, `/v2/`) [DOCUMENTED]
- **CORS policy:** Not documented; key is account-level secret and must never be used client-side, so browser CORS is irrelevant for our proxy use. [INFERRED]
- **Field casing:** camelCase throughout (`userId`, `firstName`, `isArchived`, `createdAt`, `assignedUserIds`) [DOCUMENTED]
- **ID format (IMPORTANT — mixed):**
  - Users, smart groups, time clocks, schedulers, custom fields: **integer** IDs (e.g. `userId: 7031021`) [DOCUMENTED]
  - **Jobs: UUID strings** (e.g. `"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d"`) [DOCUMENTED]
  - **Scheduler shifts: opaque string / Mongo-style hex IDs** (e.g. `"6784dacb3c07733b0a849f49"`) [DOCUMENTED]
  - Do NOT assume all IDs are integers. [DOCUMENTED]
- **Timestamps:** Unix epoch **seconds** (e.g. `createdAt: 1712573537`). Some filters (time activities) use `YYYY-MM-DD` date strings. [DOCUMENTED]
- **Required headers (all requests):**

| Header       | Value              | Purpose                                                  |
| ------------ | ------------------ | -------------------------------------------------------- |
| X-API-KEY    | `{api_key}`        | Account-level secret API key — **this connector's auth** |
| Accept       | `application/json` | Response format                                          |
| Content-Type | `application/json` | Request body format (POST/PUT)                           |

### 2.3 Authentication [REQUIRED]

> **This is the ONLY substantive difference from `connecteam-oauth`.** Get this right; everything else in the two packages is identical.

- **Auth method (this connector):** Static **API key** [DOCUMENTED]
- **Auth location:** HTTP request **header** [DOCUMENTED]
- **Auth header format:**

```
X-API-KEY: {api_key}
```

(NOT `Authorization: Bearer …` — that's the OAuth path.)

**For API Key auth (THIS connector — `connecteam-api`, authType `api-key`):**

- **How to obtain:** Connecteam web app → **Settings → API Keys → Add API key**. Owner-only; the account must be on the **Expert plan or higher** (Help Center notes some APIs/features are Enterprise-only). [DOCUMENTED]
- **Key format / pattern:** Opaque secret string, treated as a password. Not documented in detail; do not log or echo. [DOCUMENTED]
- **Rate limits per key:** Limits are **per account, not per key** (see Phase 8.1). Multiple keys on one account share the account quota. [DOCUMENTED]
- **Key rotation procedure:** Create a new key and delete the old one via Settings → API Keys; no programmatic rotation endpoint documented. [INFERRED]
- **Token lifetime:** API keys do **not expire** (indefinite validity) — contrast with OAuth's 24h token. [DOCUMENTED]
- **Registry config check:** `connectorRegistry.ts` entry `connecteam-api` has `authType: 'api-key'` with a single credential field `api_token` (type `password`, required, placeholder "Paste your Connecteam API key"). There is **no base/instance URL field** — base URL is fixed at `https://api.connecteam.com`. [DOCUMENTED — matches registry]

**For OAuth 2.0 (the OTHER connector, `connecteam-oauth` — documented here only for contrast):**

- **Grant type:** `client_credentials` (server-to-server; no user redirect / no browser authorize step) [DOCUMENTED]
- **Token URL:** `POST https://api.connecteam.com/oauth/v1/token` [DOCUMENTED]
- **Client auth at token endpoint:** HTTP Basic (Client ID = username, Client Secret = password) [DOCUMENTED]
- **Scopes:** ~18 features × {read, write, delete} — e.g. `users.read`, `schedule.write`, `time_off.delete`. Scopes are fixed at app-creation time and cannot be edited afterward. [DOCUMENTED]
- **Access token lifetime:** 24 hours; renew before expiry. [DOCUMENTED]
- **Authorization (browser) URL:** **None** — client_credentials has no user-facing authorize URL. [DOCUMENTED]

> Implication for Numa: the API-key connector is materially simpler — no token exchange, no refresh, no expiry handling. The relay just attaches `X-API-KEY` and forwards. The OAuth connector additionally needs the client-credentials token mint + caching layer.

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> ⚠️ **GATE NOT PASSED — no live call was made.** The request/response below is the canonical example from the official auth docs, reproduced for reference, NOT executed against the live API. Discovery is needed to confirm.

**Endpoint documented for first call:**

```http
GET /me HTTP/1.1
Host: api.connecteam.com
Accept: application/json
X-API-KEY: {api_key}
```

**Expected response (shape per docs envelope, illustrative):** [DOCUMENTED — shape only]

```json
{
  "requestId": "e40bff49-5e00-4549-a2d2-e339026drtc3",
  "data": {
    "object": {
      "name": "Acme Field Services",
      "ownerEmail": "owner@example.com",
      "plan": "expert"
    }
  }
}
```

- **HTTP status code:** Expected `200` [INFERRED]
- **Response headers of note:** `x-ratelimit-minute-limit`, `x-ratelimit-minute-remaining`, `x-ratelimit-minute-reset`, `x-ratelimit-day-limit`, `x-ratelimit-day-remaining`, `x-ratelimit-day-reset` [DOCUMENTED]
- **Time to first successful call:** Immediate once an Expert-plan owner mints a key [INFERRED]
- **Gotchas:** Plan gating (Expert+; some features Enterprise-only); owner-only key access; the `/me` path is unversioned/unprefixed unlike every other endpoint. [DOCUMENTED]

- [ ] **GATE CHECK: NOT completed — documentation-only investigation. Live `GET /me` call required to confirm auth + envelope.**

---

## Phase 3: Domain Model & Behavior

> Identical to `connecteam-oauth`. The API key vs OAuth distinction does not change any entity, field, or relationship.

### 3.1 Core Entities [REQUIRED]

#### Entity: User

- **API resource name / endpoint path:** `/users/v1/users`, `/users/v1/users/{userId}` [DOCUMENTED]
- **Description:** An employee / team member in the account.
- **CRUD support:** Create (`POST`), Read (`GET`), Update (`PUT`), Delete (`DELETE /users/v1/users/{userId}`), Archive (`DELETE /users/v1/users`). Also: promote to admin, notes, payslips, assignments, performance data.

**Fields:** [DOCUMENTED]

| Field          | Type    | Required? | Writable? | Description                            | Example Value        |
| -------------- | ------- | --------- | --------- | -------------------------------------- | -------------------- |
| userId         | integer | yes       | no        | Unique identifier                      | `7031021`            |
| firstName      | string  | yes       | yes       | First name                             | `"Omer"`             |
| lastName       | string  | yes       | yes       | Last name                              | `"Vered"`            |
| email          | string  | no        | yes       | Email address                          | `"user@example.com"` |
| phoneNumber    | string  | yes       | yes       | E.164 phone (login identity)           | `"+9720548888888"`   |
| userType       | string  | yes       | no        | `owner` / `admin` / `manager` / `user` | `"owner"`            |
| isArchived     | boolean | yes       | no        | Archived state                         | `false`              |
| createdAt      | integer | yes       | no        | Unix epoch seconds                     | `1712573537`         |
| modifiedAt     | integer | yes       | no        | Unix epoch seconds                     | `1723640035`         |
| lastLogin      | integer | no        | no        | Unix epoch seconds                     | `1723640035`         |
| smartGroupsIds | array   | no        | yes       | Smart group memberships                | `[2359154, 2359155]` |
| customFields   | array   | no        | yes       | Custom field values                    | see below            |

**Custom field shape:** `{ "customFieldId": 6208755, "name": "Title", "type": "str", "value": "Solution Engineer" }` [DOCUMENTED]

#### Entity: Time Clock

- **API resource name / endpoint path:** `/time_clock/v1/time_clocks`, `/time_clock/v1/time_clocks/{timeClockId}/...`
- **Description:** A time-clock instance (a clock employees punch into). Container for time activities, geofences, breaks, timesheet totals.
- **CRUD support:** Read (`GET /time_clock/v1/time_clocks`). Real-time actions: `clock_in`, `clock_out`. Sub-resources: time_activities (R/W), geofences (CRUD), manual_breaks (R), shift_attachments (R), timesheet (R), lock_days (W).

**Fields:** [DOCUMENTED]

| Field      | Type    | Required? | Writable? | Description    | Example Value              |
| ---------- | ------- | --------- | --------- | -------------- | -------------------------- |
| id         | integer | yes       | no        | Time clock ID  | `12345`                    |
| name       | string  | yes       | no        | Display name   | `"Main Office Time Clock"` |
| isArchived | boolean | yes       | no        | Archived state | `false`                    |

> **NOTE:** Archived time clocks ARE returned by the list endpoint. Historical data is readable, but new entries cannot be created against an archived clock. [DOCUMENTED]

#### Entity: Time Activity

- **API resource name / endpoint path:** `/time_clock/v1/time_clocks/{timeClockId}/time_activities` (GET / POST / PUT)
- **Description:** A recorded work segment (shift), manual break, or time-off block tied to a user on a given time clock.
- **CRUD support:** Create, Read, Update (no delete via API documented).

**Fields (within `shifts[]`):** [DOCUMENTED]

| Field          | Type    | Required? | Writable?    | Description                              | Example Value    |
| -------------- | ------- | --------- | ------------ | ---------------------------------------- | ---------------- |
| id             | string  | yes       | no           | Activity / shift identifier              | `"shift-abc123"` |
| userId         | integer | yes       | yes (create) | Employee                                 | `9170357`        |
| start          | object  | yes       | yes          | `{ timestamp, timezone, locationData? }` | see below        |
| end            | object  | yes       | yes          | `{ timestamp, timezone, locationData? }` | see below        |
| jobId          | string  | no        | yes          | Associated job (UUID)                    | `"job-123"`      |
| subJobId       | string  | no        | yes          | Associated sub-job                       | `"subjob-456"`   |
| employeeNote   | string  | no        | yes          | Employee note                            | `"Imported"`     |
| managerNote    | string  | no        | yes          | Manager note                             | `""`             |
| isAutoClockOut | boolean | no        | no           | Was auto-clocked-out                     | `false`          |
| createdAt      | integer | yes       | no           | Unix epoch seconds                       | `1704110400`     |

**start/end object:** `{ "timestamp": 1704110400, "timezone": "America/New_York", "locationData": {...} }` [DOCUMENTED]

#### Entity: Scheduler & Shift

- **API resource name / endpoint path:** `/scheduler/v1/schedulers`, `/scheduler/{v1|v2}/schedulers/{schedulerId}/shifts`
- **Description:** A scheduler holds shifts assigned to users. **Two API versions:** V1 and V2 (see `/docs/scheduler-shifts-vision`). V2 is the newer surface.
- **CRUD support:** Shifts: Create, Read, Update, Delete (both V1 and V2). Plus shift layers, custom fields, unavailabilities, auto-assign.

**Shift fields:** [DOCUMENTED]

| Field           | Type    | Required? | Writable? | Description                   | Example Value                            |
| --------------- | ------- | --------- | --------- | ----------------------------- | ---------------------------------------- |
| id              | string  | yes       | no        | Shift identifier (hex string) | `"6784dacb3c07733b0a849f49"`             |
| title           | string  | no        | yes       | Shift name                    | `"Morning Shift"`                        |
| assignedUserIds | array   | no        | yes       | Assigned employee IDs         | `[9170357]`                              |
| startTime       | integer | yes       | yes       | Unix epoch seconds            | `1736924400`                             |
| endTime         | integer | yes       | yes       | Unix epoch seconds            | `1736953200`                             |
| jobId           | string  | no        | yes       | Associated job (UUID)         | `"d4ad7232-576f-2ff6-c57d-8240f1089b00"` |
| isPublished     | boolean | yes       | yes       | Visible to employees          | `true`                                   |
| isOpenShift     | boolean | yes       | yes       | Claimable / unassigned        | `false`                                  |
| color           | string  | no        | yes       | Hex colour                    | `"#4B7AC5"`                              |

> **V1 vs V2:** Both exist concurrently. Mirror the `connecteam-oauth` package's choice; default to **V2** for new work per the docs' migration guidance, but keep V1 endpoints available. Shift IDs are string/hex in both. [DOCUMENTED — version-specific ID format differences not fully spelled out; INFERRED for migration default]

#### Entity: Job (resource)

- **API resource name / endpoint path:** `/jobs/v1/jobs`, `/jobs/v1/jobs/{jobId}`
- **Description:** A job/task/cost-code that time activities and shifts can be attributed to. Supports sub-jobs (hierarchy).
- **CRUD support:** Create, Read, Update, Delete. Also `/jobs/v1/custom_fields`.

**Fields:** [DOCUMENTED]

| Field        | Type          | Required? | Writable? | Description                        | Example Value                            |
| ------------ | ------------- | --------- | --------- | ---------------------------------- | ---------------------------------------- |
| jobId        | string (UUID) | yes       | no        | Unique identifier                  | `"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d"` |
| title        | string        | yes       | yes       | Job name                           | `"Delivery Driver"`                      |
| code         | string        | no        | yes       | Job code                           | `"DD-001"`                               |
| color        | string        | no        | yes       | Hex colour                         | `"#3968BB"`                              |
| description  | string        | no        | yes       | Description                        | `"Delivery operations"`                  |
| gps          | object        | no        | yes       | `{ address, longitude, latitude }` | see below                                |
| isDeleted    | boolean       | yes       | no        | Soft-deleted state                 | `false`                                  |
| assign       | object        | no        | yes       | `{ type, userIds[], groupIds[] }`  | `{"type":"both","userIds":[7031021]}`    |
| instanceIds  | array         | no        | yes       | Scheduler/time-clock IDs job is on | `[6833518]`                              |
| customFields | array         | no        | yes       | Resource custom fields             | `[]`                                     |
| parentId     | string        | no        | yes       | Parent job (for sub-jobs)          | —                                        |
| subJobs      | array         | no        | no        | Child jobs                         | —                                        |

**gps object:** `{ "address": "123 Main St", "longitude": -73.93, "latitude": 40.71 }` [DOCUMENTED]

#### Entity: Form & Form Submission

- **API resource name / endpoint path:** `/forms/v1/forms`, `/forms/v1/forms/{formId}`, `/forms/v1/forms/{formId}/form_submissions`, `.../{formSubmissionId}`
- **Description:** Digital forms and the submissions employees fill in. The key reporting/extraction surface. (Help Center notes Forms API is Enterprise-plan only.)
- **CRUD support:** Forms: Read. Submissions: Read, Update (`PUT` — manager fields). Dropdown question options: full CRUD.

**Form fields:** `formId`, `name`, `isArchived` [DOCUMENTED]
**Form submission fields:** `formSubmissionId`, `userId`, `submissionTime`, `answers`/`questions`, `status` [DOCUMENTED — full field shape not in public example]

#### Other entities (from `/llms.txt`, fields not individually deep-dived) [DOCUMENTED — list of endpoints]

- **Smart Groups / Segments** — `/users/v1/smart_groups`, `/users/v1/smart_group_segments` (CRUD-ish)
- **Custom Fields (users)** — `/users/v1/custom_fields` (+ categories, options) full CRUD
- **Tasks / Task Boards / Sub-tasks / Labels** — `/tasks/v1/taskboards/...` CRUD
- **Time Off** — policy types, balances, assignments, requests (`/time_off/v1/...`)
- **Pay Rates** — `/pay_rates/v1/pay_rates` (R/W/Delete)
- **Company Policies / Pay Rule Policies** — `/company_policies/v1/...`
- **Sales Data** — locations, transactions, daily sales (`/sales/v1/...`)
- **Onboarding** — packs + assignments (`/onboarding/v1/...`)
- **Chat / Messaging** — conversations, messages, publishers (`/chat/v1/...`, `/publishers/v1/...`)
- **Assets** — `/assets/v1/asset/{assetId}` (R)
- **Attachments / Files** — generate upload URL, complete upload, metadata, download URL (`/attachments/v1/files/...`)
- **Webhooks / Settings** — `/settings/v1/webhooks` CRUD

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐   N:M (assign)   ┌──────────┐
│   User   │<────────────────>│   Job    │ (UUID id; sub-jobs via parentId)
└──────────┘                  └──────────┘
     │  1:N                         ▲
     │                              │ jobId on activities/shifts
     ▼                              │
┌──────────────┐   on     ┌──────────────┐        ┌──────────────┐
│ TimeActivity │─────────>│  TimeClock   │        │  Scheduler   │
│ (shift/break)│  clock   │ (integer id) │        │ (integer id) │
└──────────────┘          └──────────────┘        └──────────────┘
     │ userId                                            │ 1:N
     ▼                                                   ▼
┌──────────┐        ┌──────────────┐            ┌──────────────┐
│   User   │        │ SmartGroup   │<──members──│    Shift     │ (hex string id)
└──────────┘        └──────────────┘            └──────────────┘

┌──────────┐  1:N  ┌──────────────────┐
│   Form   │──────>│ FormSubmission   │──userId──> User
└──────────┘       └──────────────────┘
```

### 3.3 State Machines [IMPORTANT]

#### State Machine: Time Activity / Real-time clocking

```
[clocked_out] --POST clock_in--> [clocked_in] --POST clock_out--> [clocked_out]
                                       │
                                       └── (auto clock-out) --> [clocked_out] (isAutoClockOut=true)
```

| From State  | Action/Trigger               | To State    | Reversible? | Side Effects                          |
| ----------- | ---------------------------- | ----------- | ----------- | ------------------------------------- |
| clocked_out | POST .../clock_in            | clocked_in  | yes         | Opens an active time activity         |
| clocked_in  | POST .../clock_out           | clocked_out | yes         | Closes the activity, records duration |
| clocked_in  | auto clock-out (server rule) | clocked_out | no          | `isAutoClockOut: true`                |

[DOCUMENTED — endpoints; INFERRED — exact transitions]

#### State Machine: Shift

```
[draft / unpublished] --publish (isPublished=true)--> [published]
[assigned] <--> [open] (isOpenShift toggles; open shifts are claimable)
```

| State       | Can Update? | Can Delete? | Notes                                      |
| ----------- | ----------- | ----------- | ------------------------------------------ |
| unpublished | yes         | yes         | `isPublished:false` — not visible to staff |
| published   | yes         | yes         | Visible to assigned employees              |
| open        | yes         | yes         | `isOpenShift:true` — unassigned/claimable  |

[INFERRED from field semantics]

### 3.4 Business Rules [IMPORTANT]

- **Plan gating:** API access requires **Expert plan or higher**; **Forms API (and some others) are Enterprise-only**. A valid key on a lower tier will be rejected/limited. [DOCUMENTED]
- **Owner-only keys:** Only account owners can create/manage API keys. [DOCUMENTED]
- **Time-activity date range cap:** GET time_activities `startDate`/`endDate` range **cannot exceed 92 days**. [DOCUMENTED]
- **Schedule shifts require a time window:** GET shifts requires `startTime` + `endTime`; shifts are returned if they **overlap** the range. [DOCUMENTED]
- **Forward-compatible schemas:** Docs explicitly warn new fields may be added to responses — parse leniently, don't fail on unknown fields. [DOCUMENTED]
- **Archived/deleted visibility:** Archived time clocks are listed; jobs use `isDeleted` soft-delete with `includeDeleted` filter. [DOCUMENTED]
- **Mixed ID types:** integers for users/clocks/schedulers, UUIDs for jobs, hex strings for shifts — never coerce. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format        | Pattern                | Example                    | Notes                                         |
| ------------- | ---------------------- | -------------------------- | --------------------------------------------- |
| Timestamp     | Unix epoch **seconds** | `1712573537`               | Almost all time fields; rate-limit resets too |
| Date filter   | `YYYY-MM-DD`           | `2025-01-15`               | time_activities startDate/endDate             |
| Integer ID    | integer                | `7031021`                  | users, time clocks, schedulers, custom fields |
| UUID ID       | RFC4122 string         | `9fdebf1f-0c69-4914-...`   | jobs                                          |
| Hex/string ID | 24-char hex string     | `6784dacb3c07733b0a849f49` | scheduler shifts                              |
| Phone         | E.164                  | `+9720548888888`           | user login identity                           |
| Colour        | `#RRGGBB`              | `#4B7AC5`                  | shifts, jobs                                  |
| Timezone      | IANA tz name           | `"America/New_York"`       | start/end objects                             |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity        | Field         | Allowed Values                                                | Notes                                 |
| ------------- | ------------- | ------------------------------------------------------------- | ------------------------------------- |
| User          | userType      | `owner`, `admin`, `manager`, `user`                           | `owner` seen in docs; others INFERRED |
| Users query   | userStatus    | `active` (default), `archived` (and likely `all`)             | INFERRED                              |
| Time activity | activityTypes | `shift`, `manual_break`, `time_off`                           | [DOCUMENTED]                          |
| Job assign    | type          | `both`, `users`, `groups`                                     | `both` seen; rest INFERRED            |
| Webhook       | featureType   | `users`, `forms`, `time_activity`, `shift_scheduler`, `tasks` | [DOCUMENTED]                          |
| Sort order    | order         | `asc` (default), `desc`                                       | [DOCUMENTED]                          |

---

## Phase 4: Endpoint Catalog

> Endpoints are identical to `connecteam-oauth`. **The only difference is the auth header** (`X-API-KEY: {key}` here vs `Authorization: Bearer {token}` for OAuth). Examples below use `X-API-KEY`.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /me

- **Purpose:** Return the authenticated account's identity — the canonical auth smoke-test.
- **Authentication required:** yes
- **Idempotent:** yes
- **Note:** Unversioned, unprefixed path (the only one).

```http
GET /me HTTP/1.1
Host: api.connecteam.com
Accept: application/json
X-API-KEY: {api_key}
```

#### Endpoint: GET /users/v1/users

- **Purpose:** List employees with filtering, sorting, pagination.
- **Authentication required:** yes — `X-API-KEY`
- **Idempotent:** yes

**Query parameters:** [DOCUMENTED]

| Parameter      | Type             | Required | Default  | Description                      |
| -------------- | ---------------- | -------- | -------- | -------------------------------- |
| limit          | integer (1-500)  | no       | 10       | Page size                        |
| offset         | integer          | no       | 0        | Pagination offset                |
| sort           | string           | no       | —        | Sort field (user creation time)  |
| order          | string           | no       | `asc`    | `asc` / `desc`                   |
| userIds        | array            | no       | —        | Specific user IDs                |
| userStatus     | string           | no       | `active` | Status filter                    |
| fullNames      | array            | no       | —        | Exact, case-sensitive name match |
| phoneNumbers   | array            | no       | —        | E.164 phone match                |
| emailAddresses | array            | no       | —        | Email match                      |
| createdAt      | integer (unix s) | no       | —        | Users created after timestamp    |
| modifiedAt     | integer (unix s) | no       | —        | Users modified after timestamp   |

**Success response (200):** [DOCUMENTED]

```json
{
  "requestId": "string",
  "data": {
    "users": [
      {
        "userId": 7031021,
        "firstName": "Omer",
        "lastName": "Vered",
        "email": "user@example.com",
        "phoneNumber": "+9720548888888",
        "userType": "owner",
        "isArchived": false,
        "createdAt": 1712573537,
        "modifiedAt": 1723640035,
        "lastLogin": 1723640035,
        "smartGroupsIds": [2359154, 2359155],
        "customFields": [{ "customFieldId": 6208755, "name": "Title", "type": "str", "value": "Solution Engineer" }]
      }
    ]
  },
  "paging": { "offset": 0 }
}
```

#### Endpoint: GET /jobs/v1/jobs

- **Purpose:** List jobs/cost-codes.
- **Authentication required:** yes
- **Idempotent:** yes

**Query parameters:** `instanceIds[]`, `jobIds[]`, `jobNames[]`, `jobCodes[]`, `includeDeleted` (bool), `sort` (`title`), `order` (`asc`/`desc`), `limit` (default 10, max 500), `offset`. [DOCUMENTED]

```http
GET /jobs/v1/jobs?instanceIds=6833518&limit=100 HTTP/1.1
Host: api.connecteam.com
X-API-KEY: {api_key}
```

**Success response (200):** [DOCUMENTED]

```json
{
  "requestId": "abc123-def456",
  "data": {
    "paging": { "offset": 100 },
    "jobs": [
      {
        "jobId": "9fdebf1f-0c69-4914-89d2-8f86c3e5f47d",
        "title": "Delivery Driver",
        "code": "DD-001",
        "color": "#3968BB",
        "description": "Delivery operations",
        "gps": { "address": "123 Main St", "longitude": -73.93, "latitude": 40.71 },
        "isDeleted": false,
        "assign": { "type": "both", "userIds": [7031021], "groupIds": [] },
        "instanceIds": [6833518],
        "customFields": []
      }
    ]
  }
}
```

#### Endpoint: GET /time_clock/v1/time_clocks/{timeClockId}/time_activities

- **Purpose:** List time activities (worked shifts, manual breaks, time-off) for a clock.
- **Authentication required:** yes
- **Idempotent:** yes
- **Constraint:** `startDate`/`endDate` required (`YYYY-MM-DD`); range ≤ 92 days.

**Query parameters:** `startDate`, `endDate` (required), `userIds[]`, `jobIds[]`, `manualBreakIds[]`, `policyTypeIds[]`, `activityTypes[]` (`shift`/`manual_break`/`time_off`). [DOCUMENTED]

**Create request (POST) body:** [DOCUMENTED]

```json
{
  "timeActivities": [
    {
      "userId": 9170357,
      "shifts": [
        {
          "start": { "timestamp": 1704110400, "timezone": "America/New_York" },
          "end": { "timestamp": 1704139200, "timezone": "America/New_York" },
          "jobId": "job-123",
          "employeeNote": "Imported from external system"
        }
      ],
      "manualbreaks": []
    }
  ]
}
```

#### Endpoint: GET /scheduler/v1/schedulers/{schedulerId}/shifts (and v2)

- **Purpose:** List shifts overlapping a time window.
- **Authentication required:** yes
- **Idempotent:** yes
- **Required:** `startTime`, `endTime` (unix seconds).

**Query parameters:** `startTime`, `endTime` (required), `jobId[]`, `assignedUserIds[]`, `isOpenShift` (bool), `isPublished` (bool), `limit` (default 10, max 500), `offset`. [DOCUMENTED]

**Success response (200):** [DOCUMENTED]

```json
{
  "data": {
    "shifts": [
      {
        "id": "6784dacb3c07733b0a849f49",
        "title": "Morning Shift",
        "assignedUserIds": [9170357],
        "startTime": 1736924400,
        "endTime": 1736953200,
        "jobId": "d4ad7232-576f-2ff6-c57d-8240f1089b00",
        "isPublished": true,
        "isOpenShift": false,
        "color": "#4B7AC5"
      }
    ]
  }
}
```

#### Endpoint: GET /forms/v1/forms/{formId}/form_submissions

- **Purpose:** Retrieve form submissions for reporting/extraction (Enterprise-only).
- **Authentication required:** yes
- **Idempotent:** yes
- **Fields per submission:** `formSubmissionId`, `userId`, `submissionTime`, `answers`/`questions`, `status`. [DOCUMENTED — partial]

### 4.2 Full Endpoint Index [IMPORTANT]

> Full list from `developer.connecteam.com/llms.txt` (~110 endpoints). All require `X-API-KEY` auth. Pagination (offset/limit) applies to list endpoints. [DOCUMENTED]

| Method              | Path                                                            | Purpose                             |
| ------------------- | --------------------------------------------------------------- | ----------------------------------- |
| GET                 | /me                                                             | Account identity (smoke test)       |
| POST                | /oauth/v1/token                                                 | OAuth token (OAuth connector only)  |
| GET                 | /users/v1/users                                                 | List users                          |
| POST                | /users/v1/users                                                 | Create users                        |
| PUT                 | /users/v1/users                                                 | Update users                        |
| DELETE              | /users/v1/users/{userId}                                        | Delete user                         |
| DELETE              | /users/v1/users                                                 | Archive users                       |
| POST                | /users/v1/admins                                                | Promote to admin                    |
| GET                 | /users/v1/users/{userId}/assignments                            | Get user assignments                |
| POST                | /users/v1/users/{userId}/notes                                  | Create user note                    |
| POST                | /users/v1/users/{userId}/payslips                               | Upload payslip                      |
| GET                 | /users/v1/performance_indicators                                | Get indicators                      |
| PUT                 | /users/v1/users/{userId}/performance/{date}                     | Update performance                  |
| GET/POST/PUT/DELETE | /users/v1/smart_groups[/{id}]                                   | Smart groups CRUD                   |
| GET/POST            | /users/v1/smart_group_segments                                  | Smart group segments                |
| GET/POST/PUT/DELETE | /users/v1/custom_fields[...]                                    | User custom fields CRUD             |
| GET                 | /users/v1/custom_field_categories                               | Custom field categories             |
| GET                 | /time_clock/v1/time_clocks                                      | List time clocks                    |
| POST                | /time_clock/v1/time_clocks/{id}/clock_in                        | Clock in                            |
| POST                | /time_clock/v1/time_clocks/{id}/clock_out                       | Clock out                           |
| GET/POST/PUT        | /time_clock/v1/time_clocks/{id}/time_activities                 | Time activities R/W                 |
| GET/POST/DELETE     | /time_clock/v1/time_clocks/{id}/geofences[/{fenceId}]           | Geofences CRUD                      |
| GET                 | /time_clock/v1/time_clocks/{id}/manual_breaks                   | Manual breaks                       |
| GET                 | /time_clock/v1/time_clocks/{id}/shift_attachments               | Shift attachments                   |
| GET                 | /time_clock/v1/time_clocks/{id}/timesheet                       | Timesheet totals                    |
| PUT                 | /time_clock/v1/time_clocks/{id}/users/{userId}/lock_days        | Lock days                           |
| GET                 | /scheduler/v1/schedulers                                        | List schedulers                     |
| GET                 | /scheduler/v1/schedulers/{id}/shift_layers[/{layerId}/values]   | Shift layers / values               |
| GET                 | /scheduler/v1/schedulers/{id}/custom_fields                     | Shift custom fields                 |
| GET/POST/DELETE     | /scheduler/v1/schedulers/{id}/unavailabilit\*                   | Unavailabilities                    |
| GET/POST/PUT/DELETE | /scheduler/v1/schedulers/{id}/shifts[/{shiftId}]                | Shifts V1 CRUD                      |
| GET/POST/PUT/DELETE | /scheduler/v2/schedulers/{id}/shifts[/{shiftId}]                | Shifts V2 CRUD (preferred)          |
| POST/GET            | /scheduler/{v1,v2}/schedulers/{id}/shifts_auto_assign[/{reqId}] | Auto-assign                         |
| GET                 | /scheduler/{v1,v2}/schedulers/user_unavailability               | User unavailabilities               |
| GET/POST/PUT/DELETE | /jobs/v1/jobs[/{jobId}]                                         | Jobs CRUD                           |
| GET                 | /jobs/v1/custom_fields                                          | Resource custom fields              |
| GET                 | /forms/v1/forms[/{formId}]                                      | Forms                               |
| GET/PUT             | /forms/v1/forms/{formId}/form_submissions[/{id}]                | Form submissions R/U                |
| GET/POST/PUT/DELETE | /forms/v1/forms/{formId}/questions/{questionId}[...]            | Dropdown options CRUD               |
| GET/POST/PUT/DELETE | /tasks/v1/taskboards/{id}/tasks[/{taskId}][...]                 | Tasks + sub-tasks CRUD              |
| GET                 | /tasks/v1/taskboards[/{id}/labels]                              | Task boards / labels                |
| GET/PUT/POST        | /time_off/v1/...                                                | Time off policies/balances/requests |
| GET/PUT/DELETE      | /pay_rates/v1/pay_rates[...]                                    | Pay rates                           |
| GET/PUT             | /company_policies/v1/pay_rule_policies[...]                     | Pay rule policies                   |
| GET/POST/PUT/DELETE | /sales/v1/...                                                   | Sales locations/transactions/daily  |
| GET/POST            | /onboarding/v1/packs[...]                                       | Onboarding packs                    |
| GET/POST            | /chat/v1/conversations[...]                                     | Chat                                |
| GET                 | /publishers/v1/publishers                                       | Custom publishers                   |
| GET                 | /assets/v1/asset/{assetId}                                      | Asset metadata                      |
| POST/PUT/GET        | /attachments/v1/files/...                                       | File upload/download URLs           |
| GET/POST/PUT/DELETE | /settings/v1/webhooks[/{webhookId}]                             | Webhook CRUD                        |

---

## Phase 5: Query & Filter Capabilities

> Identical to `connecteam-oauth`.

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?   | Syntax                                                       | Notes                                            |
| ------------------------------- | ------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| Filter by field value           | Yes          | `?userStatus=active`, `?jobCodes=DD-001`                     | Per-endpoint named filters [DOCUMENTED]          |
| Filter by ID list               | Yes          | `?userIds=1&userIds=2` (array)                               | Repeated param array [DOCUMENTED]                |
| Filter by date/time range       | Yes          | `?startDate=&endDate=` / `?startTime=&endTime=`              | Date string OR unix s, per endpoint [DOCUMENTED] |
| Filter "modified since"         | Yes          | `?modifiedAt={unix}` (users)                                 | Polling-friendly [DOCUMENTED]                    |
| Full-text search                | No           | —                                                            | Only exact match filters [INFERRED]              |
| Sort by field                   | Yes          | `?sort=title`                                                | Limited fields per endpoint [DOCUMENTED]         |
| Sort direction                  | Yes          | `?order=asc` / `desc`                                        | Default asc [DOCUMENTED]                         |
| Field selection / sparse fields | No           | —                                                            | Not documented [INFERRED]                        |
| Include related records         | No           | —                                                            | Separate calls needed [INFERRED]                 |
| Include deleted/archived        | Partial      | `?includeDeleted=true` (jobs); archived clocks always listed | [DOCUMENTED]                                     |
| Aggregate / count               | No           | —                                                            | No total-count field returned [DOCUMENTED]       |
| Logical operators (AND/OR)      | Implicit AND | Multiple params                                              | [INFERRED]                                       |
| Comparison operators (gt/lt)    | No           | —                                                            | Only range-by-pair (start/end) [INFERRED]        |

### 5.2 Filter Syntax [REQUIRED]

```
GET /users/v1/users?userStatus=active&modifiedAt=1723600000&limit=100&offset=0
GET /jobs/v1/jobs?jobCodes=DD-001&includeDeleted=false&sort=title&order=asc
GET /time_clock/v1/time_clocks/{id}/time_activities?startDate=2025-01-01&endDate=2025-03-01&userIds=9170357&activityTypes=shift
GET /scheduler/v2/schedulers/{id}/shifts?startTime=1736900000&endTime=1737500000&isPublished=true
```

- Array filters use **repeated query params** (`?userIds=1&userIds=2`). [INFERRED — common REST pattern; confirm in discovery]
- Multiple distinct filters combine with **implicit AND**. [INFERRED]

### 5.3 Sort Syntax [IMPORTANT]

```
?sort=title&order=desc
```

Sort fields are a small per-endpoint allow-list (e.g. jobs: `title`; users: creation time). [DOCUMENTED]

### 5.5 Search Capabilities [IMPORTANT]

- No global search endpoint. [INFERRED]
- Per-resource lookups via exact-match filters (`fullNames`, `phoneNumbers`, `emailAddresses` on users; `jobNames`/`jobCodes` on jobs). `fullNames` is **case-sensitive exact match**. [DOCUMENTED]
- Fuzzy matching: not supported. [INFERRED]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: All active employees (paginated)**

```http
GET /users/v1/users?userStatus=active&limit=200&offset=0
X-API-KEY: {api_key}
```

**Pattern 2: Time activities for a clock over a month**

```http
GET /time_clock/v1/time_clocks/12345/time_activities?startDate=2025-04-01&endDate=2025-04-30
X-API-KEY: {api_key}
```

**Pattern 3: Published shifts for a scheduler this week**

```http
GET /scheduler/v2/schedulers/6833518/shifts?startTime=1745020800&endTime=1745625600&isPublished=true
X-API-KEY: {api_key}
```

**Pattern 4: Users changed since last sync (polling)**

```http
GET /users/v1/users?modifiedAt=1745000000&limit=200
X-API-KEY: {api_key}
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** offset/limit [DOCUMENTED]
- **Default page size:** 10 [DOCUMENTED]
- **Maximum page size:** 500 (documented on users and jobs; assume 500 globally) [DOCUMENTED / INFERRED for other endpoints]
- **Total count available:** **No** — no `total`/`hasMore` field. The response `paging` object only echoes an `offset`. [DOCUMENTED]

**Request parameters:**

| Parameter | Type    | Default | Description              |
| --------- | ------- | ------- | ------------------------ |
| limit     | integer | 10      | Items per page (max 500) |
| offset    | integer | 0       | Starting position        |

**Response structure:**

```json
{
  "requestId": "abc123",
  "data": {
    "users": [
      /* ... */
    ]
  },
  "paging": { "offset": 0 }
}
```

> ⚠️ Note inconsistency across the API: some endpoints place `paging` at the **top level** (users), others **inside `data`** (jobs/shifts `data.paging.offset`). Parsers must check both locations. [DOCUMENTED]

**How to detect last page:** the returned array has **fewer items than `limit`**. There is no explicit terminator field. [DOCUMENTED]

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /users/v1/users?limit=200&offset=0     -> 200 items  (keep going)
Page 2: GET /users/v1/users?limit=200&offset=200   -> 200 items  (keep going)
Page 3: GET /users/v1/users?limit=200&offset=400   ->  37 items  (< limit -> STOP, last page)
```

### 6.3 Bulk Operations [IMPORTANT]

- **Bulk create/update users:** `POST /users/v1/users` and `PUT /users/v1/users` accept **arrays** of users in one call. [DOCUMENTED]
- **Bulk create time activities:** `POST .../time_activities` takes a `timeActivities[]` array, each with multiple `shifts[]`. [DOCUMENTED]
- **Bulk create shifts:** `POST .../shifts` accepts multiple shifts. [DOCUMENTED]
- **Bulk delete:** `DELETE .../shifts` (no shiftId) and `DELETE /users/v1/users` (archive) operate on multiple. [DOCUMENTED]
- **Partial failure handling:** Not documented — unknown whether bulk ops are all-or-nothing or per-item. **Discovery needed.** [UNKNOWN]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- No dedicated async export endpoint. Bulk reads use offset/limit paging. [INFERRED]
- Mind the **day-level rate limit** (Phase 8.1) when paging large datasets. [DOCUMENTED]

---

## Phase 7: Real-Time & Event-Driven

> Identical to `connecteam-oauth` — webhooks are managed by the same API and fire regardless of which auth method created the webhook.

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                                |
| ------------------------ | ---------- | ---------------------------------------------------- |
| Webhooks                 | **Yes**    | Full CRUD API `/settings/v1/webhooks` [DOCUMENTED]   |
| WebSocket                | No         | [INFERRED]                                           |
| Server-Sent Events (SSE) | No         | [INFERRED]                                           |
| Long polling             | No         | [INFERRED]                                           |
| Change feeds / streams   | No         | Use `modifiedAt` filter polling instead [DOCUMENTED] |

### 7.2 Webhooks [IMPORTANT]

**Setup:** Registered via API — `POST /settings/v1/webhooks`. [DOCUMENTED]

**Request body:**

```json
{
  "name": "My form sync",
  "url": "https://my-endpoint.example.com/connecteam",
  "featureType": "forms",
  "eventTypes": ["form_submission", "form_submission_edited"],
  "objectId": 6208755,
  "isDisabled": false,
  "secretKey": "my-shared-secret"
}
```

- `objectId` is required for all feature types **except `users`**. [DOCUMENTED]
- `secretKey` is optional, for signature verification. [DOCUMENTED]

**Event Catalog:** [DOCUMENTED]

| featureType     | Event types                                                              |
| --------------- | ------------------------------------------------------------------------ |
| users           | user_created, user_updated, user_deleted, user_archived, user_promoted   |
| forms           | form_submission, form_submission_edited, manager_field_updated           |
| time_activity   | clock_in, clock_out, admin_add, admin_edit, admin_approved_add_request   |
| shift_scheduler | shift_created, shift_updated, shift_deleted, availability_status_created |
| tasks           | task_published, task_completed                                           |

**Webhook record response fields:** `id`, `name`, `userId`, `timeCreated`, `url`, `isDisabled`, `featureType`, `objectId`, `retryLimit` (fixed 3), `eventTypes`. [DOCUMENTED]

**Verification / security:**

- **Signature:** Provided via optional `secretKey`; exact signature header + algorithm not documented. **Discovery needed.** [UNKNOWN]
- **Payload format:** Per-event payload schemas live in the per-feature webhook docs (`/docs/*-webhook`); not captured in detail here. [DOCUMENTED — pages exist; UNKNOWN — exact payloads]

**Reliability:**

- **Retry policy:** `retryLimit` fixed at **3**. [DOCUMENTED]
- Retry schedule, dead-letter, ordering, dedup: not documented. [UNKNOWN]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** `GET /users/v1/users?modifiedAt={lastSync}` for user changes; for shifts/time activities, re-query the relevant time window. [DOCUMENTED]
- **Recommended polling interval:** Constrained by per-plan minute + day limits — for SBP (5/min, 100/day) poll sparingly; Expert (100/min) can poll every 1-5 min. [DOCUMENTED]
- **Change detection field(s):** `modifiedAt` (users), timestamps on activities/shifts. [DOCUMENTED]

---

## Phase 8: Operational Concerns

> Identical to `connecteam-oauth` — limits are per-account, independent of auth method.

### 8.1 Rate Limits [REQUIRED]

**Per-account** (NOT per key/token), tiered by plan: [DOCUMENTED]

| Plan       | Per Minute | Per Day |
| ---------- | ---------- | ------- |
| SBP        | 5          | 100     |
| Expert     | 100        | 10,000  |
| Enterprise | 200        | 20,000  |

- **Rate limit headers (six, all returned):** [DOCUMENTED]

| Header                       | Meaning                           | Example      |
| ---------------------------- | --------------------------------- | ------------ |
| x-ratelimit-minute-limit     | Max req in minute window          | `100`        |
| x-ratelimit-minute-remaining | Remaining this minute             | `87`         |
| x-ratelimit-minute-reset     | Minute window reset (UTC epoch s) | `1745625660` |
| x-ratelimit-day-limit        | Max req in day window             | `10000`      |
| x-ratelimit-day-remaining    | Remaining today                   | `9213`       |
| x-ratelimit-day-reset        | Day window reset (UTC epoch s)    | `1745712000` |

- **Rate limit exceeded response:** HTTP **429 Too Many Requests**, body uses the `detail` field, e.g. `{ "detail": "Too many requests" }`. [DOCUMENTED]
- **Retry-After header:** **NOT documented** — rely on `x-ratelimit-*-reset` epoch values instead. [DOCUMENTED]
- **Known quirk:** A community report notes the API sometimes returns **200 OK instead of 429** under certain conditions. Treat the `x-ratelimit-*-remaining` headers as the source of truth and throttle proactively. [DOCUMENTED — community report, not official]
- **Backoff strategy:** Exponential backoff + honour `*-reset` timestamps; proactively pause when `*-remaining` is low. [DOCUMENTED]

### 8.2 Error Handling [REQUIRED]

**Standard error response format:** [DOCUMENTED — partial]

```json
{ "detail": "Too many requests" }
```

> The success envelope is `{ requestId, data, paging? }`. The error shape observed in docs/community uses a **`detail`** string field. A `requestId` may also be present on errors. A comprehensive per-status error table is **not published** — the docs defer to the live API Reference. **Discovery needed to confirm 401/403/422 bodies.** [DOCUMENTED / UNKNOWN]

**Error codes reference:** [INFERRED from standard REST conventions + documented 429]

| HTTP Status | Meaning                  | Retryable? | Recovery Action                                         |
| ----------- | ------------------------ | ---------- | ------------------------------------------------------- |
| 400         | Bad request / validation | No         | Fix request per `detail`                                |
| 401         | Missing/invalid API key  | No         | Verify `X-API-KEY` value; key may be revoked            |
| 403         | Forbidden / plan-gated   | No         | Check plan tier (Expert+/Enterprise) and feature access |
| 404         | Not found                | No         | Verify resource ID (mind int vs UUID vs hex string)     |
| 422         | Validation failed        | No         | Fix fields per `detail`                                 |
| 429         | Rate limited             | Yes        | Honour `x-ratelimit-*-reset`; exponential backoff       |
| 5XX         | Server error             | Yes        | Retry with backoff                                      |

> ⚠️ Auth note: an invalid `X-API-KEY` returns 401/403 (exact body unconfirmed). This is the **one** error surface that differs in cause from the OAuth connector (which would instead fail at the token-mint step).

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** None documented. [UNKNOWN]
- **Naturally idempotent:** GET yes; PUT yes (full update); DELETE yes; POST no. [INFERRED]

### 8.5 File Handling [IMPORTANT]

- **Attachments API:** Two-step pre-signed flow — `POST /attachments/v1/files/generate_upload_url` → upload bytes to returned URL → `PUT /attachments/v1/files/complete_upload/{fileId}`. Download via `POST /attachments/v1/files/download_url`. Metadata via `GET /attachments/v1/files/{fileId}`. [DOCUMENTED]
- Also: user payslip upload (`POST /users/v1/users/{userId}/payslips`), shift attachments (read), assets metadata. [DOCUMENTED]
- Max file size / allowed types: not documented. [UNKNOWN]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                                 | When to Use                   | Fits?        | Notes                                                    |
| ------------------------------------ | ----------------------------- | ------------ | -------------------------------------------------------- |
| **Data Connector**                   | Browsable file-like content   | No           | Not a document store; structured workforce data          |
| **Data Connector (Files)**           | Primarily a file system       | No           | Attachments exist but are peripheral                     |
| **Direct API via `connect_request`** | Action/data-oriented REST API | **Best fit** | Read + write across users, time, scheduling, jobs, forms |
| **Hybrid**                           | Browsable content AND actions | No           | No meaningful "browse files" surface                     |

**Selected integration path:** **Direct API via `connect_request`** (authType `api-key`).

**Justification:** Connecteam is an action- and data-oriented REST API for workforce management (employees, time clock, scheduling, jobs, forms, time off). There is no file-browser surface that maps to Files Remote (the few attachment endpoints are peripheral). The workspace agent should call Connecteam endpoints directly through the connector's `connect_request` mechanism — the relay attaches the stored `api_token` as the `X-API-KEY` header and forwards to `https://api.connecteam.com`. This is the same model as the Fergus example's Direct-API portion. Because auth is a static header (no token exchange, no refresh, no expiry), the API-key path is the simplest of the two Connecteam connectors to operate.

### 9.2 Connector Requirements [IMPORTANT]

Not a Data Connector (Files) — the `list_files`/`download_file` interface does not apply. The connector is purely `connect_request`-driven.

- **Auth type for connector:** API Key (`X-API-KEY` header), single credential field `api_token` per the registry. [DOCUMENTED — matches `connectorRegistry.ts`]
- **Base URL:** `https://api.connecteam.com` (fixed; no instance/region field). [DOCUMENTED]
- **Connector category:** HR & Workforce (per registry `category: 'HR & Workforce'`). [DOCUMENTED — matches registry]
- **Caching appropriate:** Light caching of slow-changing lists (jobs, schedulers, forms, smart groups) — but be conservative given write operations and the **day-level rate limit**; invalidate on writes. [INFERRED]

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. List / search employees, jobs, time clocks, schedulers, forms, smart groups, time-off policies. [DOCUMENTED]
2. Read time activities (timesheets) and shifts within a date/time window for reporting. [DOCUMENTED]
3. Create/update users (bulk), shifts, time activities, tasks, jobs, time-off requests. [DOCUMENTED]
4. Read form submissions for extraction/reporting (Enterprise plan). [DOCUMENTED]
5. Manage webhooks for downstream automations. [DOCUMENTED]
6. Real-time clock_in / clock_out actions. [DOCUMENTED]

**CANNOT do (out of scope or risky):**

1. Bulk-archive/delete users without explicit user confirmation (destructive). [INFERRED]
2. Query time-activity ranges > 92 days in one call (hard API limit). [DOCUMENTED]
3. Rely on a total-count for pagination (none exists) — must page until short. [DOCUMENTED]
4. Assume `Retry-After` on 429 — must read `x-ratelimit-*-reset`. [DOCUMENTED]
5. Use features above the account's plan (SBP has only 5 req/min, 100/day; Forms is Enterprise-only). [DOCUMENTED]

**Default parameters:**

| Parameter  | Default | Reason                                                         |
| ---------- | ------- | -------------------------------------------------------------- |
| limit      | 200     | Fewer round-trips; well under the 500 cap, respects day budget |
| order      | desc    | Most-recent-first is usually wanted                            |
| userStatus | active  | Exclude archived employees unless asked                        |
| offset     | 0       | Start of result set                                            |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK           | Language | Quality | Maintained? | Worth Using? | Notes                                    |
| ------------- | -------- | ------- | ----------- | ------------ | ---------------------------------------- |
| None official | —        | —       | —           | No           | Call REST directly via `connect_request` |
| Official MCP  | —        | n/a     | Yes         | Reference    | `/docs/mcp`; for AI agents — informative |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified, quality assessed
- [x] Phase 2 complete: auth documented (`X-API-KEY`); first call **documented but NOT live-tested**
- [x] Phase 3 complete: core entities (User, Time Clock, Time Activity, Shift, Job, Form) + others listed
- [x] Phase 4 complete: 6 critical endpoints with request/response; full index from `llms.txt`
- [x] Phase 5 complete: query/filter patterns documented
- [x] Phase 6 complete: offset/limit pagination with worked example
- [x] Phase 7 complete: webhook catalog + polling fallback
- [x] Phase 8 complete: per-plan rate limits + headers; error shape (`detail`) documented, full table inferred
- [x] Phase 9 complete: integration path = Direct API via `connect_request`

**Overall investigation confidence:** **medium** — comprehensive official documentation, but **no live API call**; error-body details and a few field shapes are inferred. Mirror `connecteam-oauth` for everything except auth.

**Known gaps that will reduce output quality:**

1. No live test — auth, envelope, and error bodies (401/403/422) unconfirmed. Live `GET /me` + a deliberate-error call needed.
2. Webhook payload schemas and signature/HMAC verification mechanism not captured. Read `/docs/*-webhook` pages during build.
3. Bulk-operation partial-failure semantics unknown (all-or-nothing vs per-item).
4. Per-endpoint max page size assumed 500 from users/jobs; unconfirmed for all endpoints.
5. Scheduler shift V1-vs-V2 exact differences (ID formats, response shapes) need the `/docs/scheduler-shifts-vision-*` pages.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                                                  |
| ---------------------------- | ------------- | ----------- | ------------------------------------------------------------------------------------- |
| 01-llm-api-rules             | Yes           | Medium      | Auth solid (X-API-KEY); error table partly inferred                                   |
| 01a-domain-model-reference   | Yes           | Medium      | Core entities documented; some field shapes inferred                                  |
| 01b-query-patterns           | Yes           | Medium-High | Pagination/filters well documented                                                    |
| 01c-mutation-patterns        | Yes           | Medium      | Create bodies for users/time-activities/shifts documented; validation rules thin      |
| 01d-event-and-error-handling | Yes           | Medium      | Webhook catalog + rate limits solid; error bodies inferred                            |
| 02-api-spec-investigation    | Yes           | Medium      | Full endpoint index from `llms.txt`; not live-verified                                |
| 03-connector-setup           | Yes           | High        | Direct API via connect_request; `X-API-KEY` header, fixed base URL — matches registry |

---

## Appendix: Relationship to `connecteam-oauth`

Both connectors target the **same Connecteam REST API** at `https://api.connecteam.com`. Keep their domain/query/mutation/event/error docs **in sync** — divergence is a bug. The differences are confined to auth:

| Aspect              | `connecteam-api` (this)            | `connecteam-oauth`                                     |
| ------------------- | ---------------------------------- | ------------------------------------------------------ | ----- | ------------------------------- |
| authType (registry) | `api-key`                          | `oauth2` (client_credentials)                          |
| Credential fields   | `api_token`                        | Client ID + Client Secret                              |
| Header sent         | `X-API-KEY: {key}`                 | `Authorization: Bearer {access_token}`                 |
| Token lifecycle     | None — key is static, no expiry    | `POST /oauth/v1/token` (Basic auth) → 24h token, renew |
| Scopes              | None (full account access per key) | `feature.{read                                         | write | delete}`, fixed at app creation |
| Failure surface     | 401/403 on bad/revoked key         | Token-mint failure, then 401 on expired bearer         |
| Relay complexity    | Lowest (attach header, forward)    | Higher (mint + cache + refresh token)                  |

Everything else — base URL, endpoints, entities, pagination (offset/limit, no total count, mixed `paging` location), per-account rate limits + six `x-ratelimit-*` headers, the `detail` error field, webhooks, 92-day time-activity cap, mixed ID types — is **identical**.
