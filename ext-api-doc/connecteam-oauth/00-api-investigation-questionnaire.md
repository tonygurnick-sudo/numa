---
api_name: 'Connecteam API (OAuth)'
api_slug: 'connecteam-oauth'
vendor: 'Connecteam Ltd.'
website: 'https://connecteam.com'
investigation_started: '2026-05-29'
investigation_updated: '2026-05-29'
investigator: 'Claude Code (Opus 4.8)'
investigation_status: 'complete'
documentation_quality: 'good'
api_types: [REST]
overall_confidence: 'medium'
blockers:
  [
    'No live OAuth credentials for test calls — CRITICAL GATE not passed',
    'Registry oauth.authUrl/tokenUrl (app.connecteam.com/oauth/*) DISAGREE with the official OAuth 2.0 docs (api.connecteam.com/oauth/v1/token, client_credentials only) — see Phase 2.3. Must reconcile before build.',
    'Enterprise plan required to enable the public API — most endpoints are gated',
  ]
---

# API Investigation Questionnaire: Connecteam (OAuth)

> Completed investigation for the **Connecteam OAuth** connector (`connecteam-oauth`, authType `oauth2`).
>
> **Shared-API note:** This is the **same REST API** as the `connecteam-api` (API-key) connector. The domain model, endpoint catalog, query/filter, pagination, error, and webhook documentation are **identical** — only the authentication differs (OAuth bearer token vs `X-API-KEY` header). Keep `01a-domain-model-reference.md`, `01b-query-patterns.md`, and `01c-mutation-patterns.md` consistent between the two connectors; the only divergence is Phase 2.3 (Authentication) and the connector setup doc.
>
> All answers carry confidence markers per template requirements. No live calls were possible — almost nothing is `[CONFIRMED]`.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://developer.connecteam.com [CONFIRMED — responds; ReadMe-hosted developer portal]
- **API reference / endpoint catalog URL:** https://developer.connecteam.com/reference (per-endpoint pages, e.g. `/reference/get_users_users_v1_users_get`, `/reference/create_users_users_v1_users_post`, `/reference/get_form_submissions_forms_v1_forms__formid__form_submissions_get`) [CONFIRMED — pages fetched]
- **Authentication guide URL:** https://developer.connecteam.com/docs/authentication-1 and https://developer.connecteam.com/docs/oauth-20 [CONFIRMED — both fetched]
- **Changelog / release notes URL:** https://developer.connecteam.com/changelog [CONFIRMED — lists "Clock in & out API release" and others]
- **Status page URL:** [UNKNOWN — no dedicated public status page found]
- **Help-centre API articles:** https://help.connecteam.com/en/collections/11374088-api-s-integrations (Forms API, Job Scheduler API, API Documentation) [CONFIRMED]
- **LLM-friendly index:** https://developer.connecteam.com/llms.txt [INFERRED — referenced by the ReadMe platform; not directly fetched]

> **Discovery tip:** The portal is ReadMe-hosted; reference pages follow the slug pattern `{verb}_{operationId}`. The `/reference` section is described in-docs as "the authoritative source … updated in real-time with production."

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** [INFERRED — ReadMe portals are usually backed by an OpenAPI spec; a public `openapi.json` URL was not located. Discovery needed.]
- **Postman collection URL:** [UNKNOWN — no official public Postman workspace found]
- **Official SDK repositories:**
  - Python: [UNKNOWN — no official SDK; docs show raw `requests` examples]
  - Node.js: [UNKNOWN — no official SDK; docs show raw `fetch`/curl examples]
  - Other: [UNKNOWN]
- **Official blog / engineering blog:** [UNKNOWN]
- **Community forums / Stack Overflow tag:**
  - Developer discussions: https://developer.connecteam.com/discuss [CONFIRMED — active Q&A, e.g. "Fetch form submission PDF file"]
  - Feature request board: https://connecteam.canny.io/publicapi [CONFIRMED — public API roadmap board]
  - apitracker.io listing: https://apitracker.io/a/connecteam [CONFIRMED]
  - Pipedream app (Connecteam): https://pipedream.com/apps/connecteam [CONFIRMED — pre-built actions/triggers]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                                                                                   |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication            | 3      | API-key flow is clear; OAuth 2.0 page is **Beta** and documents only `client_credentials`. Conflicts with the registry config (Phase 2.3). [DOCUMENTED] |
| Endpoint reference        | 4      | ReadMe reference with per-operation pages for Users, Time Clock, Scheduler, Forms, Jobs, Attachments, Webhooks. [CONFIRMED]                             |
| Request/response examples | 3      | curl/Python snippets present on guide pages; full response schemas often hidden behind the interactive "Try It" widget. [DOCUMENTED]                    |
| Error documentation       | 2      | 200 / 422 noted per-endpoint; no global error-body schema page found. [INFERRED]                                                                        |
| Rate limit documentation  | 4      | Per-account tiered limits + `x-ratelimit-*` headers explicitly documented. [DOCUMENTED]                                                                 |
| Pagination documentation  | 4      | `limit`/`offset` documented with an explicit last-page heuristic. [DOCUMENTED]                                                                          |
| Webhook documentation     | 4      | `POST /settings/v1/webhooks`, feature types + event catalog, `secretKey` + `retryLimit` documented. [DOCUMENTED]                                        |
| SDKs / code examples      | 2      | No official SDK; raw HTTP examples only. [DOCUMENTED]                                                                                                   |
| Changelog / versioning    | 3      | Public changelog page exists; versioning is per-module path segment (`/v1/`). [DOCUMENTED]                                                              |

**Overall documentation quality:** good — endpoint reference, pagination, rate limits, and webhooks are well covered. The weak spots are the OAuth Beta flow (and its mismatch with the connector registry) and the absence of a global error-body schema.

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (developer.connecteam.com)
- [ ] Found or confirmed no OpenAPI/Swagger spec — likely present (ReadMe) but URL not located
- [x] Identified authentication method (OAuth 2.0 Beta + API key) — **with an unresolved registry conflict**
- [x] Found at least one working example (curl `GET /me` with `X-API-KEY`)
- [x] Identified rate limit information (per-account tiers + headers)
- [x] Identified pagination approach (offset/limit)
- [x] Checked for webhook/event support (`/settings/v1/webhooks`, 5 feature types)
- [x] Checked for official SDKs (none found)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Connecteam API [DOCUMENTED]
- **Vendor / company:** Connecteam Ltd. [CONFIRMED]
- **Current API version:** Per-module path versioning, all currently `v1` (e.g. `/users/v1`, `/time-clock/v1`, `/scheduler/v1`, `/forms/v1`, `/settings/v1`) [DOCUMENTED]
- **Base URL(s):**
  - Production (global): `https://api.connecteam.com` [DOCUMENTED — introduction + authentication pages]
  - Production (Australia data residency): `https://api-au.connecteam.com` [DOCUMENTED — introduction page]
  - Sandbox / testing: [UNKNOWN — no sandbox environment documented; testing uses a live Enterprise account]
- **API type:** REST (JSON) [CONFIRMED]

> **Plan gating:** The public API is **Enterprise-plan only**. On lower plans the API/Integration tabs are not exposed. [DOCUMENTED — Forms/Scheduler help articles]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1+) [DOCUMENTED]
- **Data format:** JSON [CONFIRMED]
- **Content-Type header(s):** `application/json` (requests with bodies); `Accept: application/json` recommended [DOCUMENTED — curl examples]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:** [DOCUMENTED]

```
https://api.connecteam.com/{module}/v1/{resource}
https://api.connecteam.com/{module}/v1/{resource}/{id}
https://api.connecteam.com/{module}/v1/{resource}/{id}/{sub-resource}

Examples:
  https://api.connecteam.com/users/v1/users
  https://api.connecteam.com/time-clock/v1/time-clocks/{timeClockId}/time-activities
  https://api.connecteam.com/scheduler/v1/schedulers/{schedulerId}/shifts
  https://api.connecteam.com/forms/v1/forms/{formId}/form-submissions
```

- **Versioning strategy:** URL path, per-module (`/{module}/v1/`) [DOCUMENTED]
- **CORS policy:** [UNKNOWN] — irrelevant for Numa; all calls are server-side via `connect_request`.
- **Required headers (all requests):**

| Header        | Value                                                                         | Purpose                           |
| ------------- | ----------------------------------------------------------------------------- | --------------------------------- |
| Authorization | `Bearer {access_token}` (OAuth) **OR** `X-API-KEY: {key}` (API-key connector) | Auth — see Phase 2.3 [DOCUMENTED] |
| Accept        | `application/json`                                                            | Response format [DOCUMENTED]      |
| Content-Type  | `application/json`                                                            | On POST/PUT bodies [DOCUMENTED]   |

### 2.3 Authentication [REQUIRED]

> **This section is the only material divergence from the `connecteam-api` (API-key) connector — and it contains an unresolved conflict that must be reconciled before building.**

- **Auth method (this connector):** OAuth 2.0 [DOCUMENTED — registry `authType: 'oauth2'`]
- **Auth location:** HTTP header [DOCUMENTED]
- **Auth header format:** `Authorization: Bearer {access_token}` [DOCUMENTED — OAuth docs]

**Connector registry config (`connectorRegistry.ts` → `connecteam-oauth`) — the values Numa actually uses today:** [CONFIRMED — read from source]

| Field            | Value                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `authType`       | `oauth2`                                                                                         |
| `oauth.authUrl`  | `https://app.connecteam.com/oauth/authorize`                                                     |
| `oauth.tokenUrl` | `https://app.connecteam.com/oauth/token`                                                         |
| `oauth.scopes`   | `forms.read attachments.write`                                                                   |
| setup steps      | "Connecteam Developer Portal → Create an integration", set redirect URI, copy Client ID + Secret |

**⚠️ CONFLICT — registry vs official OAuth 2.0 docs:** [DOCUMENTED — https://developer.connecteam.com/docs/oauth-20]

The official **OAuth 2.0 (Beta)** documentation describes a **different** flow than the registry implies:

| Aspect            | Registry (`connecteam-oauth`)                   | Official OAuth 2.0 (Beta) docs                                 |
| ----------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Grant type        | Implies `authorization_code` (has an `authUrl`) | **`client_credentials` only** (server-to-server)               |
| Authorization URL | `https://app.connecteam.com/oauth/authorize`    | **None** — no authorization/consent endpoint in a CC flow      |
| Token URL         | `https://app.connecteam.com/oauth/token`        | **`https://api.connecteam.com/oauth/v1/token`**                |
| Token request     | (standard code exchange)                        | HTTP **Basic auth** (Client ID = username, Secret = password)  |
| App registration  | "Developer Portal → Create an integration"      | **Your Name → Integration Center → OAuth 2.0 → Create app**    |
| Scopes            | `forms.read attachments.write`                  | `feature.permission` form, e.g. `users.read`, `schedule.write` |

**Implication:** If the official docs are accurate, Connecteam OAuth is **client_credentials** (machine-to-machine, no user redirect). That does **not** fit Numa's redirect-based OAuth wizard cleanly. The `app.connecteam.com/oauth/authorize`/`/oauth/token` endpoints in the registry are **unverified** — they could not be confirmed against any official page and may have been placeholders. **Action required before build:** verify with Connecteam whether an `authorization_code` (3-legged) flow exists, or whether this connector should be reframed as client-credentials (which is closer to the API-key connector and may make `connecteam-oauth` redundant). Treat the registry endpoints as `[UNKNOWN]` until verified.

**For OAuth 2.0 — as documented (client_credentials, Beta):**

- **Grant type(s) supported:** `client_credentials` [DOCUMENTED]
- **Authorization URL:** N/A for client_credentials [DOCUMENTED]; registry value `https://app.connecteam.com/oauth/authorize` [UNKNOWN — unverified]
- **Token URL:** `https://api.connecteam.com/oauth/v1/token` [DOCUMENTED]; registry value `https://app.connecteam.com/oauth/token` [UNKNOWN — unverified]
- **Revocation URL:** [UNKNOWN]
- **Required scopes:** `feature.permission` namespace. Registry requests `forms.read attachments.write`. Per-module scopes seen in docs include `users.read`, `schedule.read`, `schedule.write`, `schedule.delete`. [DOCUMENTED — partial list]

| Scope               | Purpose                                         | Required for Numa?                                       |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `users.read`        | Read users/employees                            | Recommended (read-only chat)                             |
| `schedule.read`     | Read schedulers & shifts                        | Recommended                                              |
| `timeclock.read` \* | Read time clocks / time activities / timesheets | Recommended (\* exact slug unverified)                   |
| `forms.read`        | Read forms & submissions                        | Yes (in registry)                                        |
| `attachments.write` | Upload attachments                              | In registry — write scope; reconsider for read-only chat |
| `schedule.write`    | Create/update shifts                            | Only if mutations enabled                                |
| `schedule.delete`   | Delete shifts                                   | Avoid unless explicitly needed                           |

> **Scope gotcha:** Scopes are **immutable after app creation** — to change scopes you must create a new app. [DOCUMENTED] Choose the full read set up front.

- **Token lifetime:** Access token expires in **86400 s (24 h)** — response field `"expires_in": 86400` [DOCUMENTED]
- **Refresh token behavior:** **Not supported** in the client_credentials flow — re-request a token from the token endpoint when it expires. [DOCUMENTED — "No refresh token mechanism mentioned"]
- **PKCE required?** [UNKNOWN — not applicable to client_credentials; not documented for any code flow]
- **State parameter required?** [UNKNOWN — N/A for client_credentials]
- **Redirect URI restrictions:** [UNKNOWN — none documented for client_credentials; registry setup step instructs setting a redirect URI, which only makes sense for a code flow → reinforces the conflict above]
- **Client Secret:** Shown **only once** at app creation — store immediately. [DOCUMENTED]

**For API-key auth (the sibling `connecteam-api` connector — documented here for cross-consistency):** [DOCUMENTED]

- **Auth header:** `X-API-KEY: {key}`
- **How to obtain:** Settings → API Keys → "Add API key" (owner/Enterprise) — also surfaced as General Settings → API keys.
- **Example:** `curl --url 'https://api.connecteam.com/me' --header 'X-API-KEY: YOUR_API_KEY'`

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> **GATE NOTE:** No live OAuth credentials available. The CRITICAL GATE is **NOT passed**. The flow below is reconstructed from the OAuth 2.0 (Beta) docs.

**Step 1 — obtain a token (client_credentials, per official docs):** [DOCUMENTED]

```http
POST /oauth/v1/token HTTP/1.1
Host: api.connecteam.com
Authorization: Basic {base64(clientId:clientSecret)}
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=users.read forms.read
```

Expected token response: [DOCUMENTED]

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

**Step 2 — first authenticated call (smoke test):** [DOCUMENTED — `/me` shown in auth docs]

```http
GET /me HTTP/1.1
Host: api.connecteam.com
Accept: application/json
Authorization: Bearer eyJhbGciOi...
```

Then a real data call:

```http
GET /users/v1/users?limit=10&offset=0 HTTP/1.1
Host: api.connecteam.com
Authorization: Bearer eyJhbGciOi...
```

- **HTTP status code (expected):** 200
- **Response headers of note:** `x-ratelimit-minute-remaining`, `x-ratelimit-day-remaining`, `x-ratelimit-minute-reset` [DOCUMENTED]
- **Time to first successful call:** N/A — not attempted
- **Gotchas:** (1) Enterprise plan required to enable the API at all; (2) registry OAuth endpoints likely wrong — use `api.connecteam.com/oauth/v1/token`; (3) AU-resident tenants must use `api-au.connecteam.com`.

- [ ] **GATE CHECK: First successful API call completed and documented above** — **NOT COMPLETED (no credentials)**

---

## Phase 3: Domain Model & Behavior

> **Shared with `connecteam-api`.** Same entities and fields; only the auth layer differs.

### 3.1 Core Entities [REQUIRED]

#### Entity: User (Employee)

- **API resource name / endpoint path:** `/users/v1/users` [CONFIRMED — reference pages]
- **Description:** A Connecteam team member (employee/admin). [DOCUMENTED]
- **CRUD support:** Create (POST), Read (GET list + by ID), Update (PUT), Archive/Unarchive, Delete [DOCUMENTED]. Batch actions capped at **25 users per request**. [DOCUMENTED]

**Fields:** [DOCUMENTED — overview page; types `[INFERRED]` where schema not shown]

| Field        | Type              | Required? | Writable? | Description                              | Example                   |
| ------------ | ----------------- | --------- | --------- | ---------------------------------------- | ------------------------- |
| userId       | integer           | -         | no        | Unique user identifier                   | `4815162`                 |
| firstName    | string            | yes       | yes       | Given name                               | `"Jane"`                  |
| lastName     | string            | yes       | yes       | Family name                              | `"Doe"`                   |
| phoneNumber  | string (E.164)    | yes       | yes       | Login identity (Connecteam is phone-led) | `"+14155550101"`          |
| email        | string            | no        | yes       | Email address                            | `"jane@acme.com"`         |
| userType     | string/enum       | no        | yes       | e.g. user / manager / admin              | `"user"`                  |
| userStatus   | enum              | no        | no        | active / archived                        | `"active"`                |
| customFields | array/object      | no        | yes       | Tenant-defined custom fields             | `[{ "id":1,"value":"…"}]` |
| createdAt    | integer (epoch s) | -         | no        | Creation timestamp                       | `1716950400`              |
| modifiedAt   | integer (epoch s) | -         | no        | Last-modified timestamp                  | `1716950400`              |

#### Entity: Time Clock

- **API resource name / endpoint path:** `/time-clock/v1/time-clocks` [DOCUMENTED]
- **Description:** A configured time-tracking instrument; container for time activities. [DOCUMENTED]
- **CRUD support:** Read (list) [DOCUMENTED]; child resources hold the activity data.

#### Entity: Time Activity (Shift / Break / Time-off)

- **API resource name / endpoint path:** `/time-clock/v1/time-clocks/{timeClockId}/time-activities` [DOCUMENTED]
- **Description:** A work record under a time clock. Three categories: **shift** (clock-in/out work period), **break** (manual, paid or unpaid), **timeoff** (approved PTO appearing on the timesheet). [DOCUMENTED]
- **CRUD support:** Read (GET), Create (POST), Update (PUT) [DOCUMENTED]. Real-time `clock-in`/`clock-out` are separate POST endpoints.

**Fields:** [DOCUMENTED — overview]

| Field       | Type              | Required? | Writable? | Description                       | Example      |
| ----------- | ----------------- | --------- | --------- | --------------------------------- | ------------ |
| timeClockId | integer           | yes       | no        | Parent time-clock id (path param) | `12345`      |
| userId      | integer           | yes       | yes       | Employee the activity belongs to  | `4815162`    |
| start       | integer (epoch s) | yes       | yes       | Activity start (Unix seconds)     | `1716969600` |
| end         | integer (epoch s) | no        | yes       | Activity end; absent if open      | `1716998400` |
| type        | enum              | yes       | yes       | `shift` / `break` / `timeoff`     | `"shift"`    |

> **Range constraint:** Time-activity queries are limited to a **92-day (3-month)** window. [DOCUMENTED]

#### Entity: Timesheet

- **API resource name / endpoint path:** `/time-clock/v1/time-clocks/{timeClockId}/timesheet` [DOCUMENTED]
- **Description:** Aggregated payroll summary for a time clock over a date range. [DOCUMENTED]
- **CRUD support:** Read (GET) [DOCUMENTED]

#### Entity: Scheduler

- **API resource name / endpoint path:** `/scheduler/v1/schedulers` [DOCUMENTED]
- **Description:** A schedule board that owns shifts. [DOCUMENTED]
- **CRUD support:** Read (list) [DOCUMENTED]

#### Entity: Shift

- **API resource name / endpoint path:** `/scheduler/v1/schedulers/{schedulerId}/shifts` [DOCUMENTED]
- **Description:** A scheduled work slot on a scheduler. [DOCUMENTED]
- **CRUD support:** Read (list + by id), Create (POST, up to **500** per call), Update (PUT, bulk), Delete (bulk up to **20**, or single) [DOCUMENTED]

**Fields:** [DOCUMENTED — attributes listed; exact slugs `[INFERRED]`]

| Field        | Type              | Required? | Writable? | Description                                 | Example       |
| ------------ | ----------------- | --------- | --------- | ------------------------------------------- | ------------- |
| shiftId      | integer/string    | -         | no        | Unique shift id                             | `987654`      |
| schedulerId  | integer           | yes       | no        | Parent scheduler (path param)               | `321`         |
| type         | enum              | no        | yes       | `regular` / `open` / `draft` / `group`      | `"regular"`   |
| assignees    | array<integer>    | no        | yes       | userIds assigned to the shift               | `[4815162]`   |
| startTime    | integer (epoch s) | yes       | yes       | Shift start                                 | `1716969600`  |
| endTime      | integer (epoch s) | yes       | yes       | Shift end                                   | `1716998400`  |
| status       | enum              | no        | yes       | published / draft (derived from type/state) | `"published"` |
| shiftLayers  | array/object      | no        | yes       | Layer values (jobs/locations/notes)         | `[…]`         |
| customFields | array/object      | no        | yes       | Tenant-defined custom fields                | `[…]`         |

> **Unsupported scheduler features:** data layers, shift tasks, repeating shifts, and group shifts are explicitly **not supported** via the API. [DOCUMENTED]

#### Entity: User Unavailability

- **API resource name / endpoint path:** `/scheduler/v1/schedulers/user-unavailability` (read), `/scheduler/v1/schedulers/{schedulerId}/unavailability` (create), `/scheduler/v1/schedulers/{schedulerId}/unavailability/{unavailabilityId}` (delete) [DOCUMENTED]
- **Description:** Combined view of unavailabilities, approved time-off, and assigned shifts for users. [DOCUMENTED]

#### Entity: Form

- **API resource name / endpoint path:** `/forms/v1/forms` (list), `/forms/v1/forms/{formId}` (get) [DOCUMENTED]
- **Description:** A form template defined in Connecteam. [DOCUMENTED]
- **CRUD support:** Read [DOCUMENTED]

#### Entity: Form Submission

- **API resource name / endpoint path:** `/forms/v1/forms/{formId}/form-submissions` (list), get-single + manager-field update also documented [DOCUMENTED]
- **Description:** A completed submission of a form by a user. Manager fields (person, status, note, date) are updatable. [DOCUMENTED]
- **CRUD support:** Read (list + single), Update (manager fields only) [DOCUMENTED]

**Fields:** [INFERRED — response schema not exposed on reference page; verify against live call]

| Field         | Type              | Required? | Writable? | Description                         |
| ------------- | ----------------- | --------- | --------- | ----------------------------------- |
| submissionId  | integer/string    | -         | no        | Unique submission id                |
| formId        | integer           | -         | no        | Parent form                         |
| userId        | integer           | -         | no        | Submitting user                     |
| submittedAt   | integer (epoch s) | -         | no        | Submission timestamp                |
| entries       | array/object      | -         | no        | Question/answer pairs               |
| managerFields | object            | -         | partial   | person/status/note/date (updatable) |

> **Attachments:** Submission attachments / PDF export are referenced in the discuss forum but the retrieval pattern is not cleanly documented. [INFERRED — discovery needed]

#### Entity: Job (Job Scheduler / Sub-jobs)

- **API resource name / endpoint path:** `/jobs/v1/...` (sub-jobs page exists: `/docs/sub-jobs`) [DOCUMENTED — module exists]; exact paths [INFERRED — not fully fetched]
- **Description:** Jobs (and sub-jobs) used to tag/categorise time and shifts. [DOCUMENTED]
- **CRUD support:** Create + manage with sub-job support [DOCUMENTED]

#### Entity: Attachment

- **API resource name / endpoint path:** `/attachments/v1/...` [INFERRED — Attachments module documented; `attachments.write` scope exists]
- **Description:** Uploaded files referenced by other resources. [DOCUMENTED — module]
- **CRUD support:** Upload (write) [DOCUMENTED — scope]

#### Entity: Webhook Subscription

- **API resource name / endpoint path:** `/settings/v1/webhooks` [DOCUMENTED]
- **CRUD support:** Create (POST) [DOCUMENTED]; list/delete [INFERRED]

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐        assigned to        ┌──────────────┐
│   User   │<──────────────────────────│    Shift     │
└──────────┘                           └──────────────┘
     │  1:N                                   │ N:1
     │                                        ▼
     ▼                                  ┌──────────────┐
┌──────────────┐   under   ┌──────────┐ │  Scheduler   │
│ Time Activity │──────────>│Time Clock│ └──────────────┘
└──────────────┘           └──────────┘
     │ N:1 (userId)
     ▼
┌──────────┐   submits   ┌──────────────────┐   of   ┌──────────┐
│   User   │────────────>│ Form Submission  │───────>│   Form   │
└──────────┘             └──────────────────┘        └──────────┘
     │
     │ tagged by
     ▼
┌──────────┐
│   Job    │ (+ sub-jobs)  ── referenced by Shifts / Time Activities
└──────────┘
```

[INFERRED — relationships deduced from path nesting and field names; not from a published ERD]

### 3.3 State Machines [IMPORTANT]

#### State Machine: Time Activity (Shift) [INFERRED — from clock-in/out semantics]

```
[open] --clock-out--> [closed]
(create with start only = open; PUT/clock-out sets end = closed)
```

| From State | Action/Trigger             | To State | Reversible? | Side Effects                        |
| ---------- | -------------------------- | -------- | ----------- | ----------------------------------- |
| (none)     | POST clock-in / create     | open     | n/a         | `start` captured server-side        |
| open       | POST clock-out / PUT `end` | closed   | via edit    | `end` captured; counts on timesheet |

#### State Machine: Shift [INFERRED — from `type`: regular/open/draft]

```
[draft] --publish--> [published/regular]   (open = unassigned slot awaiting assignee)
```

### 3.4 Business Rules [IMPORTANT]

- **Enterprise-only:** the API is unavailable below the Enterprise plan. [DOCUMENTED]
- **Phone-led identity:** users are keyed on phone number; creating a user generally requires a valid phone number. [INFERRED — Connecteam product model]
- **Batch caps:** users batch ≤ 25; shift create ≤ 500; bulk shift delete ≤ 20. [DOCUMENTED]
- **Time-activity window:** queries limited to 92 days. [DOCUMENTED]
- **Immutable OAuth scopes:** cannot change scopes post-app-creation. [DOCUMENTED]
- **Unsupported scheduler features:** data layers / shift tasks / repeating / group shifts. [DOCUMENTED]
- **Data residency:** AU tenants must call `api-au.connecteam.com`. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format    | Pattern                | Example          | Notes                                                    |
| --------- | ---------------------- | ---------------- | -------------------------------------------------------- |
| Date      | `YYYY-MM-DD`           | `"2026-05-29"`   | Used by date-only fields (timesheet ranges) [DOCUMENTED] |
| Timestamp | Unix epoch **seconds** | `1716969600`     | All `start`/`end`/`createdAt`/`modifiedAt` [DOCUMENTED]  |
| Phone     | E.164                  | `"+14155550101"` | Login identity [INFERRED]                                |
| ID format | integer                | `4815162`        | Numeric IDs across modules [INFERRED]                    |
| Boolean   | boolean                | `true`/`false`   | e.g. `sendActivation` [DOCUMENTED]                       |

> **Watch-out:** Connecteam uses **Unix seconds**, not milliseconds and not ISO-8601, for activity/shift times. Mixing these up is the most likely integration bug. [DOCUMENTED]

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity        | Field      | Allowed Values                      | Default   | Notes                                  |
| ------------- | ---------- | ----------------------------------- | --------- | -------------------------------------- |
| Time Activity | type       | `shift`, `break`, `timeoff`         | [UNKNOWN] | [DOCUMENTED]                           |
| Shift         | type       | `regular`, `open`, `draft`, `group` | [UNKNOWN] | `group` not API-supported [DOCUMENTED] |
| Users list    | userStatus | `active`, `archived`, `all`         | `active`  | query filter [DOCUMENTED]              |
| Users list    | order      | `asc`, `desc`                       | `asc`     | [DOCUMENTED]                           |
| Users list    | sort       | `created_at`                        | [UNKNOWN] | only sort key documented [DOCUMENTED]  |

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /users/v1/users

- **Purpose:** List users with filtering + pagination [DOCUMENTED]
- **Authentication required:** yes
- **Idempotent:** yes

**Query parameters:** [DOCUMENTED]

| Parameter                                       | Type               | Required | Default  | Description                   |
| ----------------------------------------------- | ------------------ | -------- | -------- | ----------------------------- |
| limit                                           | integer (1–500)    | No       | 10       | Page size                     |
| offset                                          | integer (≥0)       | No       | 0        | Start position                |
| sort                                            | string             | No       | —        | Allowed: `created_at`         |
| order                                           | enum               | No       | `asc`    | `asc` / `desc`                |
| userIds                                         | array<int>         | No       | —        | Filter by specific user ids   |
| userStatus                                      | enum               | No       | `active` | `active` / `archived` / `all` |
| fullNames                                       | array<string>      | No       | —        | Filter by name                |
| phoneNumbers                                    | array<string>      | No       | —        | Filter by phone               |
| emailAddresses                                  | array<string>      | No       | —        | Filter by email               |
| createdAt / modifiedAt / lastLogin / archivedAt | integer (epoch ≥1) | No       | —        | Time filters                  |

**Success response (200):** [INFERRED — envelope shape not shown verbatim; reconstructed from ReadMe norms]

```json
{
  "requestId": "req_8f3c…",
  "data": {
    "users": [
      {
        "userId": 4815162,
        "firstName": "Jane",
        "lastName": "Doe",
        "phoneNumber": "+14155550101",
        "email": "jane@acme.com",
        "userType": "user",
        "userStatus": "active"
      }
    ]
  },
  "paging": { "limit": 10, "offset": 0 }
}
```

#### Endpoint: POST /users/v1/users

- **Purpose:** Create user(s) — batch ≤ 25 [DOCUMENTED]
- **Idempotent:** no

**Query parameters:** `sendActivation` (boolean, default `false`) [DOCUMENTED]

**Request body:** [INFERRED — `users` array]

```json
{ "users": [{ "firstName": "Jane", "lastName": "Doe", "phoneNumber": "+14155550101", "email": "jane@acme.com" }] }
```

**Responses:** `200 Successful Response`, `422 Validation Error` [DOCUMENTED]

#### Endpoint: GET /time-clock/v1/time-clocks/{timeClockId}/time-activities

- **Purpose:** Query time activities (shifts/breaks/time-off) for a clock [DOCUMENTED]
- **Constraint:** date range ≤ 92 days [DOCUMENTED]
- **Companion writes:** `POST .../time-activities` (create), `PUT .../time-activities` (modify), `POST .../clock-in`, `POST .../clock-out` [DOCUMENTED]

#### Endpoint: GET /scheduler/v1/schedulers/{schedulerId}/shifts

- **Purpose:** List shifts with filters [DOCUMENTED]
- **Companion writes:** `POST .../shifts` (create ≤ 500), `PUT .../shifts` (bulk update), `DELETE .../shifts` (bulk ≤ 20), `DELETE .../shifts/{shiftId}` (single), `POST .../shifts/auto-assign` + `GET .../shifts/auto-assign/{requestId}` (async) [DOCUMENTED]

#### Endpoint: GET /forms/v1/forms/{formId}/form-submissions

- **Purpose:** List submissions for a form [DOCUMENTED]

**Query parameters:** [DOCUMENTED]

| Parameter                | Type          | Required | Default | Description            |
| ------------------------ | ------------- | -------- | ------- | ---------------------- |
| userIds                  | array<int>    | No       | —       | Filter by submitter    |
| submittingStartTimestamp | integer       | No       | —       | Window start (epoch s) |
| submittingEndTime        | integer       | No       | —       | Window end (epoch s)   |
| limit                    | integer 1–100 | No       | 10      | Page size              |
| offset                   | integer ≥0    | No       | 0       | Start position         |

#### Endpoint: POST /settings/v1/webhooks

- **Purpose:** Register a webhook subscription [DOCUMENTED]

```json
{
  "name": "Numa user sync",
  "url": "https://example.com/hooks/connecteam",
  "feature": "users",
  "events": ["user_created", "user_updated"],
  "secretKey": "whsec_…",
  "retryLimit": 3
}
```

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path                                                              | Purpose                     | Auth? | Pagination? | Confidence   |
| ------ | ----------------------------------------------------------------- | --------------------------- | ----- | ----------- | ------------ |
| GET    | `/me`                                                             | Account/identity smoke test | Yes   | No          | [DOCUMENTED] |
| GET    | `/users/v1/users`                                                 | List users                  | Yes   | Yes         | [DOCUMENTED] |
| POST   | `/users/v1/users`                                                 | Create users (≤25)          | Yes   | No          | [DOCUMENTED] |
| GET    | `/users/v1/users/{userId}`                                        | Get user                    | Yes   | No          | [INFERRED]   |
| PUT    | `/users/v1/users`                                                 | Update users                | Yes   | No          | [INFERRED]   |
| GET    | `/time-clock/v1/time-clocks`                                      | List time clocks            | Yes   | Yes         | [DOCUMENTED] |
| GET    | `/time-clock/v1/time-clocks/{id}/time-activities`                 | List time activities (≤92d) | Yes   | Yes         | [DOCUMENTED] |
| POST   | `/time-clock/v1/time-clocks/{id}/time-activities`                 | Create time activities      | Yes   | No          | [DOCUMENTED] |
| PUT    | `/time-clock/v1/time-clocks/{id}/time-activities`                 | Update time activities      | Yes   | No          | [DOCUMENTED] |
| POST   | `/time-clock/v1/time-clocks/{id}/clock-in`                        | Clock in                    | Yes   | No          | [DOCUMENTED] |
| POST   | `/time-clock/v1/time-clocks/{id}/clock-out`                       | Clock out                   | Yes   | No          | [DOCUMENTED] |
| GET    | `/time-clock/v1/time-clocks/{id}/timesheet`                       | Timesheet summary           | Yes   | Yes         | [DOCUMENTED] |
| GET    | `/scheduler/v1/schedulers`                                        | List schedulers             | Yes   | Yes         | [DOCUMENTED] |
| GET    | `/scheduler/v1/schedulers/{sid}/shifts`                           | List shifts                 | Yes   | Yes         | [DOCUMENTED] |
| GET    | `/scheduler/v1/schedulers/{sid}/shifts/{shiftId}`                 | Get shift                   | Yes   | No          | [DOCUMENTED] |
| POST   | `/scheduler/v1/schedulers/{sid}/shifts`                           | Create shifts (≤500)        | Yes   | No          | [DOCUMENTED] |
| PUT    | `/scheduler/v1/schedulers/{sid}/shifts`                           | Update shifts               | Yes   | No          | [DOCUMENTED] |
| DELETE | `/scheduler/v1/schedulers/{sid}/shifts`                           | Delete shifts (≤20)         | Yes   | No          | [DOCUMENTED] |
| DELETE | `/scheduler/v1/schedulers/{sid}/shifts/{shiftId}`                 | Delete single shift         | Yes   | No          | [DOCUMENTED] |
| GET    | `/scheduler/v1/schedulers/{sid}/shift-layers`                     | List shift layers           | Yes   | Yes         | [DOCUMENTED] |
| GET    | `/scheduler/v1/schedulers/{sid}/shift-layers/{layerId}/values`    | Layer values                | Yes   | Yes         | [DOCUMENTED] |
| GET    | `/scheduler/v1/schedulers/user-unavailability`                    | User unavailabilities       | Yes   | Yes         | [DOCUMENTED] |
| POST   | `/scheduler/v1/schedulers/{sid}/unavailability`                   | Add unavailability          | Yes   | No          | [DOCUMENTED] |
| DELETE | `/scheduler/v1/schedulers/{sid}/unavailability/{uid}`             | Remove unavailability       | Yes   | No          | [DOCUMENTED] |
| POST   | `/scheduler/v1/schedulers/{sid}/shifts/auto-assign`               | Start auto-assign (async)   | Yes   | No          | [DOCUMENTED] |
| GET    | `/scheduler/v1/schedulers/{sid}/shifts/auto-assign/{requestId}`   | Poll auto-assign            | Yes   | No          | [DOCUMENTED] |
| GET    | `/forms/v1/forms`                                                 | List forms                  | Yes   | Yes         | [DOCUMENTED] |
| GET    | `/forms/v1/forms/{formId}`                                        | Get form                    | Yes   | No          | [DOCUMENTED] |
| GET    | `/forms/v1/forms/{formId}/form-submissions`                       | List submissions            | Yes   | Yes         | [DOCUMENTED] |
| PUT    | `/forms/v1/forms/{formId}/form-submissions/{id}` (manager fields) | Update manager fields       | Yes   | No          | [INFERRED]   |
| GET    | `/jobs/v1/jobs` (+ sub-jobs)                                      | Jobs / sub-jobs             | Yes   | Yes         | [INFERRED]   |
| POST   | `/attachments/v1/...`                                             | Upload attachment           | Yes   | No          | [INFERRED]   |
| POST   | `/settings/v1/webhooks`                                           | Create webhook              | Yes   | No          | [DOCUMENTED] |

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

N/A — REST/JSON only. No GraphQL or WebSocket interface. [CONFIRMED]

---

## Phase 5: Query & Filter Capabilities

> **Shared with `connecteam-api`.**

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?         | Syntax                                                                                   | Notes                                     |
| ------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| Filter by field value           | Yes (per-endpoint) | `?userStatus=active`, `?userIds=1,2`                                                     | Whitelisted params only [DOCUMENTED]      |
| Filter by id list               | Yes                | `?userIds=...` (array)                                                                   | [DOCUMENTED]                              |
| Filter by date range            | Yes                | epoch-second params (`submittingStartTimestamp`, `createdAt`, time-activity window ≤92d) | [DOCUMENTED]                              |
| Full-text search                | No                 | —                                                                                        | No search endpoint [INFERRED]             |
| Sort by field                   | Limited            | `?sort=created_at`                                                                       | Only `created_at` documented [DOCUMENTED] |
| Sort direction                  | Yes                | `?order=asc` / `?order=desc`                                                             | [DOCUMENTED]                              |
| Field selection / sparse fields | No                 | —                                                                                        | Not documented [INFERRED]                 |
| Include related records         | No                 | —                                                                                        | Use child endpoints instead [INFERRED]    |
| Aggregate / count               | Partial            | Timesheet endpoint aggregates hours                                                      | No generic count [DOCUMENTED]             |
| Logical operators (AND/OR)      | AND only           | Multiple params AND-combined                                                             | [INFERRED]                                |
| Comparison operators (gt/lt)    | No                 | Use explicit from/to params                                                              | [INFERRED]                                |

### 5.2 Filter Syntax [REQUIRED]

**General pattern — query-string params, whitelisted per endpoint:**

```
GET /users/v1/users?userStatus=archived&order=desc&limit=100
GET /forms/v1/forms/{formId}/form-submissions?submittingStartTimestamp=1714521600&submittingEndTime=1717200000&userIds=4815162
GET /time-clock/v1/time-clocks/{id}/time-activities?startTime=1714521600&endTime=1717200000   (≤ 92 days)
```

[DOCUMENTED — params confirmed; `startTime`/`endTime` slugs for time-activities `[INFERRED]`]

**Combining filters:** multiple params are AND-combined. No OR / nested filtering. [INFERRED]

### 5.3 Sort Syntax [IMPORTANT]

```
?sort=created_at&order=asc
?sort=created_at&order=desc
```

Only `created_at` is a documented sort key for users. Other endpoints' sort support is undocumented. [DOCUMENTED / INFERRED]

### 5.4 Field Selection [NICE-TO-HAVE]

Not supported — endpoints return their full documented schema. [INFERRED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** none [INFERRED]
- **Per-resource search:** value filters only (exact-match id/name/phone/email arrays) [DOCUMENTED]
- **Fuzzy matching:** not supported [INFERRED]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: Active users, newest first**

```http
GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=100&offset=0
```

**Pattern 2: This pay-period's shifts for a scheduler**

```http
GET /scheduler/v1/schedulers/{schedulerId}/shifts?startTime=1716163200&endTime=1717372800
```

**Pattern 3: Form submissions in a date window for specific users**

```http
GET /forms/v1/forms/{formId}/form-submissions?userIds=4815162&submittingStartTimestamp=1714521600&submittingEndTime=1717200000&limit=100
```

**Pattern 4: Last 30 days of time activities for a clock (within 92-day cap)**

```http
GET /time-clock/v1/time-clocks/{timeClockId}/time-activities?startTime=1714521600&endTime=1717113600
```

---

## Phase 6: Pagination & Bulk Operations

> **Shared with `connecteam-api`.**

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** offset/limit [DOCUMENTED]
- **Default page size:** 10 [DOCUMENTED]
- **Maximum page size:** endpoint-specific — users `500`, form-submissions `100`; a global max is not published. [DOCUMENTED]
- **Total count available:** Not consistently — docs recommend the "fewer-than-limit" heuristic rather than relying on a total. [DOCUMENTED]

**Request parameters:** [DOCUMENTED]

| Parameter | Type    | Default | Description       |
| --------- | ------- | ------- | ----------------- |
| limit     | integer | 10      | Items per page    |
| offset    | integer | 0       | Starting position |

**Response structure:** a `data` object containing the result array; a `paging` echo (`limit`/`offset`) is likely but not shown verbatim. [INFERRED]

```json
{
  "requestId": "req_…",
  "data": {
    "users": [
      /* ... */
    ]
  },
  "paging": { "limit": 10, "offset": 0 }
}
```

**How to detect last page:** "Continue incrementing `offset` by `limit` until the response returns fewer items than the limit." [DOCUMENTED — verbatim guidance]

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items  (full page → continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items  (full page → continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items  (< limit → LAST PAGE)
```

### 6.3 Bulk Operations [IMPORTANT]

| Operation          | Endpoint                                       | Max Batch Size | Notes                       |
| ------------------ | ---------------------------------------------- | -------------- | --------------------------- |
| Bulk create users  | `POST /users/v1/users`                         | 25             | [DOCUMENTED]                |
| Bulk update users  | `PUT /users/v1/users`                          | 25             | [INFERRED — same batch cap] |
| Bulk create shifts | `POST /scheduler/v1/schedulers/{sid}/shifts`   | 500            | [DOCUMENTED]                |
| Bulk update shifts | `PUT /scheduler/v1/schedulers/{sid}/shifts`    | [UNKNOWN]      | bulk supported [DOCUMENTED] |
| Bulk delete shifts | `DELETE /scheduler/v1/schedulers/{sid}/shifts` | 20             | [DOCUMENTED]                |

**Partial failure handling:** [UNKNOWN — per-item error reporting format not documented; discovery needed.]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- No dedicated async export endpoint. Auto-assign is the only async/polling pattern (`POST …/auto-assign` → `GET …/auto-assign/{requestId}`). [DOCUMENTED]
- Form-submission PDF retrieval is referenced in the forum but undocumented. [INFERRED]

---

## Phase 7: Real-Time & Event-Driven

> **Shared with `connecteam-api`.**

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                            |
| ------------------------ | ---------- | ------------------------------------------------ |
| Webhooks                 | Yes        | `POST /settings/v1/webhooks` [DOCUMENTED]        |
| WebSocket                | No         | [INFERRED]                                       |
| Server-Sent Events (SSE) | No         | [INFERRED]                                       |
| Long polling             | No         | (auto-assign poll is request-scoped, not events) |
| Change feeds / streams   | No         | Use `modifiedAt` filters to poll [INFERRED]      |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** API (and UI Integration Center) [DOCUMENTED]
- **Registration endpoint:** `POST /settings/v1/webhooks` [DOCUMENTED]
- **Webhook URL requirements:** HTTPS URL required [DOCUMENTED]
- **Subscription shape:** `{ name, url, feature, events[], secretKey, retryLimit }` [DOCUMENTED]

**Event Catalog (by feature type):** [DOCUMENTED]

| Feature           | Events                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_restored`, `user_promoted`, `user_demoted` |
| `time_activity`   | `clock_in`, `clock_out` (+ admin/approval variants)                                                               |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created`, `availability_status_deleted`   |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`                                              |
| `tasks`           | `task_published`, `task_completed`                                                                                |

**Payload format:** [UNKNOWN — exact JSON body not documented on the pages fetched; discovery needed.]

**Verification / security:**

- **Signature:** a `secretKey` is supplied at registration "for webhook signature verification"; the exact signature header/algorithm is not documented. [DOCUMENTED — mechanism exists; details UNKNOWN]

**Reliability:**

- **Retry policy:** fixed `retryLimit` of 3 attempts. [DOCUMENTED]
- **Ordering / dedup guarantees:** [UNKNOWN]

### 7.3 WebSocket / SSE [NICE-TO-HAVE]

N/A. [INFERRED]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended endpoint:** any list endpoint with a `modifiedAt`/timestamp filter (e.g. `GET /users/v1/users?modifiedAt=…`). [DOCUMENTED]
- **Recommended interval:** respect per-account minute caps (Expert 100/min, Enterprise 200/min). For typical sync, poll every few minutes. [DOCUMENTED — derived from limits]
- **Change detection field(s):** `modifiedAt` (epoch s). [DOCUMENTED]

---

## Phase 8: Operational Concerns

> **Shared with `connecteam-api`.**

### 8.1 Rate Limits [REQUIRED]

| Scope (per **account**, not per key) | Limit        | Window | Notes                     |
| ------------------------------------ | ------------ | ------ | ------------------------- |
| SBP plan                             | 5 requests   | 1 min  | + 100/day [DOCUMENTED]    |
| Expert plan                          | 100 requests | 1 min  | + 10,000/day [DOCUMENTED] |
| Enterprise plan                      | 200 requests | 1 min  | + 20,000/day [DOCUMENTED] |

- **Rate limit headers:** [DOCUMENTED]

| Header                         | Meaning                         | Example      |
| ------------------------------ | ------------------------------- | ------------ |
| `x-ratelimit-minute-limit`     | Minute quota                    | `200`        |
| `x-ratelimit-minute-remaining` | Remaining this minute           | `188`        |
| `x-ratelimit-minute-reset`     | Reset time (UTC epoch seconds)  | `1716969660` |
| `x-ratelimit-day-limit`        | Daily quota                     | `20000`      |
| `x-ratelimit-day-remaining`    | Remaining today                 | `19992`      |
| `x-ratelimit-day-reset`        | Daily reset (UTC epoch seconds) | `1717027200` |

- **Rate limit exceeded response:** `HTTP 429 Too Many Requests` [DOCUMENTED]. Body shape not published [UNKNOWN].
- **Retry-After header:** [UNKNOWN — not documented]. Use `x-ratelimit-minute-reset` to compute wait.
- **Backoff strategy:** docs advise exponential backoff + monitoring the `x-ratelimit-*` headers. [DOCUMENTED]

> **Critical for Numa:** Limits are **per account**, shared by ALL API clients (this connector + any other integration). On SBP (5/min) the connector will throttle almost immediately — assume Enterprise. Cache aggressively.

### 8.2 Error Handling [REQUIRED]

**Standard error response format:** [INFERRED — no global error-schema page found; shape reconstructed from ReadMe/FastAPI conventions visible in the reference (`422 Validation Error`)]

```json
{
  "requestId": "req_8f3c…",
  "statusCode": 422,
  "message": "Validation error",
  "detail": [{ "loc": ["body", "users", 0, "phoneNumber"], "msg": "field required", "type": "value_error.missing" }]
}
```

**Error codes reference:** [INFERRED for codes not explicitly documented]

| HTTP Status | Meaning          | Retryable? | Recovery Action                                    |
| ----------- | ---------------- | ---------- | -------------------------------------------------- |
| 200         | Success          | -          | -                                                  |
| 400         | Bad request      | No         | Fix request                                        |
| 401         | Unauthorized     | Yes        | Re-fetch token (token expired) / check `X-API-KEY` |
| 403         | Forbidden        | No         | Missing scope, or non-Enterprise plan              |
| 404         | Not found        | No         | Verify id / scheduler / formId                     |
| 422         | Validation error | No         | Inspect `detail[]` field errors [DOCUMENTED]       |
| 429         | Rate limited     | Yes        | Backoff using `x-ratelimit-*` headers [DOCUMENTED] |
| 500/502/503 | Server error     | Yes        | Retry with backoff                                 |

**Validation error format:** per-endpoint reference pages explicitly list `422 Validation Error`; the `detail[]` array (loc/msg/type) is the FastAPI-style convention this portal uses. [INFERRED — confirm against a live 422]

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** [UNKNOWN — no idempotency-key header documented]
- **Naturally idempotent:** GET yes; PUT yes; DELETE yes; POST no (clock-in/clock-out and create-users are non-idempotent — guard against duplicate calls).

### 8.4 Async Operations [IMPORTANT]

- **Async op:** shift auto-assign. `POST /scheduler/v1/schedulers/{sid}/shifts/auto-assign` returns a `requestId`; poll `GET …/auto-assign/{requestId}` for status. [DOCUMENTED]

```json
{ "requestId": "asg_123", "status": "pending" }
```

### 8.5 File Handling [IMPORTANT]

- **Attachments module** exists with an `attachments.write` scope (in the registry). Upload endpoint paths `[INFERRED]` (`/attachments/v1/...`). [DOCUMENTED — module/scope; INFERRED — paths]
- **Form-submission PDF retrieval:** referenced in forum, pattern undocumented. [INFERRED]

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** none documented. [UNKNOWN]
- **Consistency:** use `modifiedAt` for change detection. [INFERRED]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                         | Fits?   | Notes                                                     |
| -------------------------- | --------------------------------------------------- | ------- | --------------------------------------------------------- |
| **Data Connector**         | API has file-like content to browse/search/download | No      | Records, not browsable files                              |
| **Data Connector (Files)** | API is primarily a file storage/document system     | No      | Not a file system (attachments are incidental)            |
| **Direct API Only**        | API is action-oriented (no browsable content)       | **Yes** | Structured HR/workforce records queried/mutated on demand |
| **Hybrid**                 | Browsable content AND actions                       | Partial | Only if form-submission PDFs are surfaced as files later  |

**Selected integration path:** **Direct API via `connect_request`** (same as the `connecteam-api` connector).

**Justification:** Connecteam exposes action/record-oriented workforce data (users, time activities, shifts, forms, jobs) — not a browsable document tree. This mirrors how the simpro example frames non-file APIs: the workspace agent issues authenticated REST calls through Numa's `connect_request` proxy (OAuth bearer token injected from the user's vault) rather than registering file-browser connector methods. It is **not** a Files connector (Drive/Gmail/OneDrive/Dropbox), so no `list_files`/`download_file` interface is needed.

> **Build blocker carried from Phase 2.3:** confirm the real OAuth flow (`client_credentials` vs `authorization_code`) before wiring `connect_request`. If Connecteam only offers `client_credentials`, the OAuth connector behaves like a per-tenant machine credential — functionally close to the API-key connector, and the redirect-style wizard fields in the registry are misleading.

### 9.2 Connector Requirements [IMPORTANT]

Not a Files Data Connector — `list_files`/`download_file`/etc. do not apply. Direct API only.

- **Auth type for connector:** OAuth 2.0 (per registry). **Caveat:** documented OAuth flow is `client_credentials`; reconcile before build.
- **Connector category:** HR & Workforce (per registry).
- **Caching appropriate:** **Yes** — per-account rate limits are shared and tight (esp. sub-Enterprise). Cache list reads (users, schedulers, forms) ~5 min; bypass for single-record fetches and any mutation.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. List/search employees (users) with status, name, phone, email filters.
2. Read time clocks, time activities (shifts/breaks/time-off) and timesheet summaries (within the 92-day window).
3. List schedulers and query shifts for a date range; read user unavailability.
4. List forms and read/filter form submissions (by user/date).
5. Read jobs / sub-jobs for categorisation context.
6. (If write scopes granted) create users, create/clock-in/clock-out time activities, create/update shifts, update form manager fields — **with explicit user confirmation**.

**CANNOT do (out of scope or dangerous):**

1. Delete users, shifts, or unavailability without explicit confirmation.
2. Bulk-delete shifts (≤20) silently — always confirm.
3. Modify payroll/timesheet-affecting records without confirmation.
4. Exceed batch caps (users 25 / shift-create 500 / shift-delete 20) or the 92-day activity window.
5. Cross data-residency boundaries — AU tenants must target `api-au.connecteam.com`.

**Default parameters:**

| Parameter   | Default   | Reason                                                      |
| ----------- | --------- | ----------------------------------------------------------- |
| limit       | 100       | Balance fewer round-trips vs payload size (well under caps) |
| order       | `desc`    | Most-recent-first is the common chat expectation            |
| date window | ≤ 90 days | Stay safely inside the 92-day time-activity cap             |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK    | Language | Quality | Maintained? | Worth Using? | Notes                                           |
| ------ | -------- | ------- | ----------- | ------------ | ----------------------------------------------- |
| (none) | —        | —       | —           | No           | No official SDK; raw HTTP via `connect_request` |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 complete: auth working, first call documented — **NOT COMPLETE** (no credentials; OAuth flow conflict unresolved)
- [x] Phase 3 complete: core entities (User, Time Activity, Shift, Form Submission, Job) with fields
- [x] Phase 4 complete: 30+ endpoints documented; 6 critical with request/response
- [x] Phase 5 complete: filter/sort/pagination patterns documented
- [x] Phase 6 complete: offset/limit pagination with worked example
- [x] Phase 7 complete: webhooks assessed (catalog + secretKey + retryLimit); payload body UNKNOWN
- [x] Phase 8 complete: rate limits + headers documented; error body INFERRED
- [x] Phase 9 complete: integration path selected (Direct API via `connect_request`)

**Overall investigation confidence:** medium

**Known gaps that will reduce output quality:**

1. **OAuth flow conflict** — registry (`app.connecteam.com/oauth/authorize`, `authorization_code`-style, scopes `forms.read attachments.write`) vs official docs (`api.connecteam.com/oauth/v1/token`, `client_credentials` only). Must be resolved before connector build. The registry auth/token URLs are treated as `[UNKNOWN]`.
2. No live calls — response envelopes, error bodies, webhook payloads, and several field schemas are `[INFERRED]`.
3. Forms/Jobs/Attachments field schemas and exact webhook payloads need first-hand discovery.
4. Enterprise-plan gating limits who can even test the API.

### 10.2 Generation Prompts [REQUIRED]

> Keep `01a` / `01b` / `01c` **identical** to the `connecteam-api` connector's equivalents (shared API). Diverge only in `01-llm-api-rules.md` (auth section) and `03-connector-setup.md` (OAuth wizard).

1. **01-llm-api-rules.md** — Source: Phase 2 (OAuth auth), 4, 8, 9. ≤300 lines. **Flag the OAuth-flow conflict explicitly.**
2. **01a-domain-model-reference.md** — Source: Phase 3. (Shared.)
3. **01b-query-patterns.md** — Source: Phase 5 + 6. (Shared.)
4. **01c-mutation-patterns.md** — Source: Phase 3 (rules) + 4 (write endpoints) + batch caps. (Shared.)
5. **01d-event-and-error-handling.md** — Source: Phase 7 + 8.
6. **02-api-spec-investigation.md** — Source: all phases, condensed.
7. **03-connector-setup.md** — Source: Phase 9 + 2 + 3. **Do not finalise until the OAuth flow is verified.**

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                                 |
| ---------------------------- | ------------- | ----------- | -------------------------------------------------------------------- |
| 01-llm-api-rules             | Yes           | Medium      | OAuth flow conflict; no live-tested examples                         |
| 01a-domain-model-reference   | Yes           | Medium      | Several field schemas inferred (Forms/Jobs/Attachments)              |
| 01b-query-patterns           | Yes           | Medium-High | Pagination + filters documented; some time params inferred           |
| 01c-mutation-patterns        | Yes           | Medium      | Write endpoints + batch caps documented; bodies inferred             |
| 01d-event-and-error-handling | Yes           | Medium      | Webhook catalog + rate limits documented; payload/error body unknown |
| 02-api-spec-investigation    | Yes           | Medium      | Broad endpoint coverage; auth caveat                                 |
| 03-connector-setup           | Blocked       | Low         | **Resolve OAuth flow (client_credentials vs code) first**            |

---

## Appendix: Sources Consulted

- Connecteam Developer Portal: https://developer.connecteam.com
- OAuth 2.0 (Beta): https://developer.connecteam.com/docs/oauth-20
- Authentication: https://developer.connecteam.com/docs/authentication-1
- Introduction / overview: https://developer.connecteam.com/docs/introduction-1
- Time Clock overview: https://developer.connecteam.com/docs/time-clock-overview
- Scheduler overview: https://developer.connecteam.com/docs/scheduler-overview
- Pagination: https://developer.connecteam.com/docs/pagination-1
- Rate limiting: https://developer.connecteam.com/docs/rate-limiting-1
- Create users (reference): https://developer.connecteam.com/reference/create_users_users_v1_users_post
- Get users (reference): https://developer.connecteam.com/reference/get_users_users_v1_users_get
- Get form submissions (reference): https://developer.connecteam.com/reference/get_form_submissions_forms_v1_forms__formid__form_submissions_get
- Webhook setup: https://developer.connecteam.com/docs/setting-up-webhook-via-api
- Forms API (help): https://help.connecteam.com/en/articles/8232324-forms-api-application-programming-interface
- Job Scheduler API (help): https://help.connecteam.com/en/articles/8231826-job-scheduler-api-application-programming-interface
- Connector registry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (entry `connecteam-oauth`)
