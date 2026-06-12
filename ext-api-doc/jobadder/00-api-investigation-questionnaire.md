---
api_name: 'JobAdder API v2'
api_slug: 'jobadder'
vendor: 'JobAdder (Job Adder Operations Pty Ltd, Sydney, Australia)'
website: 'https://jobadder.com'
investigation_started: '2026-06-10'
investigator: 'Numa API Investigation Agent (docs + community-spec investigation 2026-06-10)'
investigation_status: 'blocked' # docs research complete; Phase 2.4 authenticated-call gate NOT passed (no credentials)
documentation_quality: 'good'
api_types: [REST]
overall_confidence: 'medium'
blockers:
  - 'No JobAdder credentials were available — every endpoint requires OAuth, so no live API call has been made'
  - 'The docs portal is a JS-rendered SPA and the Zendesk KB returns 403 to scripted fetches — endpoint-level detail comes from a community OpenAPI mirror; rate limits, error bodies, and webhook mechanics all need a credentialed test'
generated_date: '2026-06-10'
---

# API Investigation Questionnaire: JobAdder

> **Source:** A Numa API investigation completed **2026-06-10** against the official JobAdder
> API portal (`https://api.jobadder.com/v2/docs`), the official OAuth2/Webhooks knowledge-base
> articles (`jobadderapi.zendesk.com`), and a community OpenAPI 2.0 mirror of the v2 spec
> (`github.com/vitaliymashkov/jobadder-api`, 197 paths) whose embedded authentication guide
> matches the official OAuth2 article verbatim.
>
> ⚠️ **NO AUTHENTICATED CALL has been made.** Every endpoint requires an OAuth bearer token
> and no credentials were available; the docs portal renders only via JS and the Zendesk KB
> blocks scripted fetches (403), so endpoint-level claims lean on the community mirror.
>
> ⚠️ **Prior internal work (TASK-043, March 2026) was a sales demo** — a Python CLI
> *simulator* with fictional data. Nothing from it is treated as an API fact in this pack.
>
> **Confidence markers:** `[DOCS]` = official JobAdder documentation · `[SPEC-community]` =
> community OpenAPI mirror (high fidelity, third-party, may lag) · `[UNVERIFIED]` = inference · `[UNKNOWN]` = looked and could not find.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** `https://api.jobadder.com/v2/docs` — interactive API reference (JS-rendered; returns only the page title to headless fetches) [DOCS]
- **Authentication guide URL:** `https://jobadderapi.zendesk.com/hc/en-us/articles/360022196774-OAuth2-Authentication` [DOCS — Zendesk KB; 403 to scripted fetch, content corroborated by the mirror's embedded auth guide]
- **Webhook guide URL:** `https://jobadderapi.zendesk.com/hc/en-us/articles/360022511513-Webhooks` [DOCS — same 403 wall; existence confirmed, detail not retrievable headlessly]
- **Developer Centre (app registration):** `https://developers.jobadder.com` — where OAuth applications are registered [DOCS]
- **Changelog / status page:** no changelog found outside the portal [UNKNOWN]; `https://status.jobadder.com` [UNVERIFIED — standard vendor pattern, confirm in a browser]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL (community):**
  `https://raw.githubusercontent.com/vitaliymashkov/jobadder-api/master/jobadder-openapi-v2.json`
  — Swagger 2.0, `host: api.jobadder.com`, `basePath: /v2`, **197 paths in 21 resource groups**,
  full scope catalog, request/response models [SPEC-community]
- **Spec fidelity check:** its `info.description` reproduces the official OAuth2 article
  verbatim (URLs, parameter tables, example token payloads) — strong evidence it derives from
  JobAdder's own swagger source, but it is a snapshot and may lag the live API [UNVERIFIED]
- **Postman collection / official SDKs:** none found — raw REST docs only [UNKNOWN — checked npm/PyPI]
- **Prior internal artifact:** `JobAdder_INTEGRATION_SUMMARY.md` (TASK-043 demo) — endpoint *shape* flavor only; all data fictional

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                              |
| ------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Authentication            | 5      | OAuth2 article is complete: URLs, params, scopes, token payloads, refresh [DOCS]    |
| Endpoint reference        | 4      | Full interactive portal + community mirror with 197 paths; portal not scriptable    |
| Request/response examples | 4      | Mirror carries full request param tables and response models [SPEC-community]       |
| Error documentation       | 2      | Status codes per endpoint (404/409/422/202) in the mirror; raw error JSON shape nowhere [UNKNOWN] |
| Rate limit documentation  | 1      | No numeric thresholds found in any retrievable source [UNKNOWN]                     |
| Pagination documentation  | 5      | limit/offset + `totalCount` + `links.next` documented on every list endpoint [SPEC-community] |
| Webhook documentation     | 2      | Official article exists but is 403-walled; not present in the community mirror      |
| SDKs / code examples      | 1      | No official SDKs                                                                    |
| Changelog / versioning    | 2      | Single `/v2` path version; no public changelog found                                |

**Overall documentation quality:** good (auth and endpoint catalog solid; rate limits, error bodies, and webhooks are the holes)

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (portal + KB articles) [DOCS]
- [x] Found a machine-readable spec — **community mirror only**, not an official download [SPEC-community]
- [x] Identified authentication method (OAuth 2.0 Authorization Code — the only method)
- [ ] Found at least one working **authenticated** example — **NOT done; no credentials** [UNKNOWN]
- [ ] Identified rate limit information — **NOT found** [UNKNOWN]
- [x] Identified pagination approach (limit/offset + totalCount + hypermedia links)
- [x] Checked webhooks (yes per official KB — detail walled) and official SDKs (none)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** JobAdder API v2 [DOCS]
- **Vendor / company:** JobAdder — recruitment ATS/CRM for agencies and in-house teams (jobs,
  candidates, applications, placements, companies, contacts, job ads, requisitions) [DOCS]
- **Current API version:** v2 — path-versioned (`/v2`); no version header [DOCS]
- **Base URL(s):** documented default `https://api.jobadder.com/v2` [DOCS]. The OAuth token
  response includes an `api` field carrying the base URL to use for that account — the
  documented example matches the default [DOCS — OAuth2 article]; see 2.3 and the Phase 9
  wiring note. Sandbox: none documented [UNKNOWN]
- **API type:** REST, JSON [DOCS]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport / format:** HTTPS only (`schemes: [https]`); JSON request/response bodies;
  attachments use `multipart/form-data` or `application/octet-stream` [SPEC-community].
  CORS: [UNVERIFIED] — irrelevant for Numa (server-side proxy)
- **URL structure pattern:** [SPEC-community]

```
https://api.jobadder.com/v2/{resource}[/{id}][/{sub-resource}]
e.g. GET /jobs · GET /jobs/{jobId}/applications · PUT /candidates/{candidateId}/status
```

- **Versioning strategy:** URL path (`/v2`); no per-request version header [SPEC-community]
- **Required headers (all requests):**

| Header          | Value              | Purpose                                       |
| --------------- | ------------------ | ---------------------------------------------- |
| `Authorization` | `Bearer <token>`   | OAuth access token on every call [DOCS]        |
| `Content-Type`  | `application/json` | POST/PUT bodies (except attachment uploads)    |
| `Accept`        | `application/json` | Standard                                       |

### 2.3 Authentication [REQUIRED]

**OAuth 2.0 Authorization Code grant — the only auth method.** There is no PAT or API-key
option [DOCS — OAuth2 article].

| Property               | Value                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| Authorize URL          | `https://id.jobadder.com/connect/authorize` [DOCS]                      |
| Token URL              | `https://id.jobadder.com/connect/token` [DOCS]                          |
| App registration       | JobAdder **Developer Centre** (`developers.jobadder.com`) → register an application → Client ID + Client Secret [DOCS] |
| Grant types            | `authorization_code` + `refresh_token` [DOCS]                           |
| Lifetimes              | Auth code **5 minutes**; access token **60 minutes** (`expires_in: 3600`) [DOCS] |
| Refresh tokens         | Issued only when `offline_access` was requested; refresh response carries a **new** `refresh_token` value in the documented example — treat rotation as the norm and re-persist on every refresh [DOCS] |
| PKCE                   | Not mentioned in the official flow (confidential client with `client_secret`) [UNKNOWN — Numa sends PKCE S256 anyway; servers that don't require it ignore it] |

**Authorize request parameters** [DOCS]: `response_type=code`, `client_id`, `scope`
(space-separated), `redirect_uri` (must match a URL registered on the app) — all required;
`state` optional (CSRF echo). Denied consent redirects back with `error=access_denied`.

**Token exchange (POST, form-encoded)** [DOCS]: `client_id`, `client_secret`,
`grant_type=authorization_code`, `code`, `redirect_uri`.

**Token response** [DOCS — exact example from the official article]:

```json
{
  "access_token": "31ff7431b4c1dde02e386122702f5460",
  "expires_in": 3600,
  "token_type": "Bearer",
  "refresh_token": "e7672885d6da2db1e56d200dd292c801",
  "api": "https://api.jobadder.com/v2"
}
```

> The **`api` field is the base URL to use for API access** for this account [DOCS]; the
> documented value matches the global default. Numa's generic OAuth callback does not capture
> it today — see Phase 9.

**Refresh (POST, form-encoded)** [DOCS]: `client_id`, `client_secret`,
`grant_type=refresh_token`, `refresh_token` — returns the same shape with a fresh
`access_token` **and a fresh `refresh_token`**.

**Scopes** — space-separated [DOCS + SPEC-community]:

| Scope            | Meaning                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| `read`           | Read/view JobAdder data (covers all read endpoints)                            |
| `write`          | Modify/manage JobAdder data (covers all write endpoints)                       |
| `offline_access` | Extended access via refresh tokens — **must be combined with other scopes**    |
| `read_<entity>` / `write_<entity>` | Granular per-resource scopes also exist: `read_job`, `write_job`, `read_candidate`, `write_candidate`, `read_company`, `write_company`, `read_contact`, `write_contact`, `read_placement`, `write_placement`, `read_jobapplication`, `write_jobapplication`, `read_requisition`, `write_requisition`, `read_jobad`, `write_jobad`, `read_user`, `read_usertask`, `read_usergroup`, `read_submission`, `read_float`, plus per-entity note scopes (`read_job_note`, `write_candidate_note`, …) [SPEC-community] |
| `partner_jobboard` / `partner_ui_action` | Job-board partner surface / partner-button integrations — out of Numa scope |

> The Numa registry requests **`read write offline_access`**. Granular scopes can constrain
> a customer's grant, at the cost of 403s on anything outside it.

**Failure semantics:** 401 = missing/expired/revoked access token → refresh, or re-consent if
refresh fails; 403 = token valid but the **grant lacks the scope** → re-consent with the right
scopes, never a refresh [UNVERIFIED — standard OAuth2 semantics; exact bodies unknown].

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No JobAdder credentials were available. No `[CONFIRMED]` claims
> exist anywhere in this pack — every endpoint requires OAuth.

**Endpoint planned for first call (when a grant exists):**

```http
GET /users/current HTTP/1.1
Host: api.jobadder.com
Authorization: Bearer {access_token}
Accept: application/json
```

(`GET /users/current` needs only the `read` scope, returns a small payload, and confirms
token + account in one round-trip [SPEC-community].)

- **Expected status:** 200 with a `UserRepresentation` body; 401 = bad/expired token;
  403 = scope missing. No special headers beyond `Authorization` [SPEC-community]

- [ ] **GATE CHECK: First successful authenticated API call completed and documented above** — **NOT DONE; blocked on credentials**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

> JobAdder is a recruitment ATS: **Companies hire via Jobs; Candidates apply (Applications);
> successful applications become Placements.** Field lists are from the mirror's response
> models [SPEC-community].

#### Entity: Job (JobOrder)

- **Endpoint path:** `/jobs`, `/jobs/{jobId}` — plus `/applications`, `/placements`, `/notes`, `/attachments`, `/submissions` sub-resources
- **Key fields:** `jobId` (int), `jobTitle`, `company{companyId,name}`, `contact`, `status{statusId,name,active}`, `numberOfJobs`, `workplaceAddress`, `category`, `location`, `workType`, `salary` (range), `fee`, `skillTags`, `custom[]`, `owner`, `recruiters[]`, `createdAt`, `updatedAt`, `closedAt`
- **Status moves:** `PUT /jobs/{jobId}/status` → **202 Accepted** (async transition)

#### Entity: Candidate

- **Endpoint path:** `/candidates`, `/candidates/{candidateId}` — plus `/applications`, `/notes`, `/attachments`, `/skills`, `/availability`, `/photo`, `/videos`, `/floats`, `/placements` sub-resources
- **Key fields:** `candidateId` (int), `firstName`, `lastName`, `email`, `phone`, `mobile`, `address`, `status`, `rating`, `seeking`, `employment` (current/ideal), `education[]`, `skillTags[]`, `custom[]`, `createdAt`, `updatedAt`
- **Special:** `DELETE /candidates/{candidateId}/privacy` — "Remove a candidate at their request" (GDPR-style erasure; **dangerous, human-confirmed only**). **Duplicate guard:** `POST /candidates` and `PUT /candidates/{id}` return **409 — "Candidate with this email already exists"**

#### Entity: Application (JobApplication)

- **Endpoint path:** `/applications`, `/applications/{applicationId}`; created via `POST /jobs/{jobId}/applications` (add candidates to a job) or `POST /candidates/{candidateId}/applications` (add jobs to a candidate) — 409 if already applied
- **Key fields:** `applicationId` (int), `jobTitle`, `jobReference`, `manual` (bool), `source`, `rating`, `status` (workflow stage), `review`, `candidate{...}`, `job{...}`, `jobAd{...}`, `custom[]`, `createdAt`, `updatedAt`
- **Workflow:** `GET /applications/lists/workflow` returns the account's stage pipeline; stage moves via `PUT /applications/{id}/status` (**202**); review lifecycle via `PUT/POST /applications/{id}/review` + `/review/accept` + `/review/reject` (all 202)

#### Entity: Placement

- **Endpoint path:** `/placements`, `/placements/{placementId}` — plus `/notes`, `/attachments`. A successful hire — permanent or contract.
- **Key fields:** `placementId` (int), `job{...}`, `candidate{...}`, `approved` (bool), `type` (Permanent/Contract), `status`, `startDate`, `endDate`, `company`, `contact`, `paymentType`, `salary`, `contractRate`, `billing`, `custom[]`
- **Status moves:** `PUT /placements/{placementId}/status` → 202; approved placements via `/jobs/{jobId}/placements/approved`

#### Entity: Company & Contact

- **Endpoint path:** `/companies`, `/companies/{companyId}` (+ `/addresses`, `/contacts`, `/jobs`, `/notes`, `/attachments`); `/contacts`, `/contacts/{contactId}`
- **Company key fields:** `companyId` (int), `name`, `status`, `mainContact`, `primaryAddress`, `parent` (hierarchy), `custom[]` — 409 on duplicate name
- **Contact key fields:** `contactId` (int), `firstName`, `lastName`, `position`, `email`, `phone`, `company{...}`, `hiringManager` (bool), `reportsTo`, `custom[]`

#### Other entities (summary) [SPEC-community]

| Entity            | Endpoints                                  | Notes                                                   |
| ----------------- | ------------------------------------------ | -------------------------------------------------------- |
| User              | `/users`, `/users/current`, `/users/{id}`  | Recruiters/consultants; `/users/current` = smoke test    |
| Requisition       | `/requisitions` (+ approve/reject/submit)  | Internal-hiring approval workflow (202 transitions)      |
| Job Ad / Job Board | `/jobads`, `/jobboards/{boardId}/ads...`  | Published ads; partner job-board surface                 |
| Note              | `/notes` + per-entity `/{id}/notes`        | Typed notes (`/jobs/lists/notetype` etc.)                |
| Attachment        | per-entity `/{id}/attachments/{attach}`    | multipart/form-data or octet-stream upload               |
| Submission / Float / User task | `/submissions`, `/floats`, `/usertasks` | CV submissions, speculative floats, to-dos |
| Reference lists   | `/categories`, `/countries`, `/locations`, `/worktypes`, `/usergroups`, `/useroffices` | Account taxonomy lookups |
| Partner actions   | `/partners/actions...` (30 paths)          | Partner-button integrations (partner_ui_action scope) — out of Numa scope |

### 3.2 Entity Relationships [IMPORTANT]

```
Company ──1:N──> Contacts (hiringManager flag)
   └──1:N──> Jobs (JobOrders) ──N:1──> Contact (hiring contact)
                  ├──1:N──> Applications <──N:1── Candidates
                  │             └── (workflow stages, review) → successful → Placement
                  ├──1:N──> Placements ──N:1──> Candidate
                  └──1:N──> Job Ads · Submissions · Notes · Attachments
Requisitions (approval workflow) ──> Jobs
Users (recruiters) own/work Jobs, Candidates, Placements
```

### 3.3 State Machines [IMPORTANT]

- **Per-account status definitions** via `GET /{resource}/lists/status` (all six major
  entities) — **status ids are account-specific; always resolve before filtering or
  transitioning** [SPEC-community]
- **Transitions are dedicated sub-resource PUTs returning 202 Accepted** (async):
  `PUT /{jobs|candidates|applications|placements|companies|contacts}/{id}/status` [SPEC-community]
- **Application review cycle:** submit → viewed → accept/reject (`/applications/{id}/review*`, all 202)
- **Requisition approval:** submit → approve/reject (+ `/history` audit trail), all 202

### 3.4 Business Rules [IMPORTANT]

- **Duplicate guards return 409:** candidate email (create + update), company name,
  job application (same candidate+job) [SPEC-community]
- **Status ids are per-account** — resolve via the `lists/status` endpoints; never hardcode
- **`offline_access` must accompany other scopes**; **auth codes expire in 5 minutes** [DOCS]
- **`limit=0` returns only `totalCount`** — cheap existence/count probe [SPEC-community]
- **Candidate privacy delete** (`DELETE /candidates/{id}/privacy`) permanently removes a person
  at their request — never automate without explicit human confirmation
- **Custom fields** per resource via `GET /{resource}/fields/custom`; values in `custom[]`

### 3.5 Field Format Reference [IMPORTANT]

| Format    | Pattern                          | Example                       | Notes                                              |
| --------- | -------------------------------- | ----------------------------- | --------------------------------------------------- |
| DateTime  | ISO-8601 / RFC 3339, **UTC assumed** | `2026-06-01T00:00:00Z`     | All date filters and timestamps [SPEC-community]    |
| ID        | integer                          | `12345`                       | `jobId`, `candidateId`, `placementId`, …            |
| Date filter | `>`/`<` prefix, repeatable      | `updatedAt=>2026-06-01`       | Inclusive; specify twice for a range [SPEC-community] |
| Sort      | field name, `-` prefix = desc    | `sort=-updatedAt`             | Multiple fields allowed [SPEC-community]            |
| Token     | opaque hex string                | `31ff7431b4c1...`             | Access + refresh tokens [DOCS]                      |
| Enums     | per-account status lists         | resolve via `lists/status`    | Never hardcode status ids                           |

---

## Phase 4: Endpoint Catalog

> Catalog from the community OpenAPI mirror — **197 paths in 21 groups** [SPEC-community].
> Paths are exact; per-field request schemas should be re-checked against the live portal
> before building writes.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /users/current (smoke test)

- Authenticated user's details — the connection probe. 200 `UserRepresentation`.

#### Endpoint: GET /jobs (find jobs)

- **Key params:** `jobId[]`, `jobTitle`, `company.companyId[]`, `company.name`, `contactId[]`,
  `statusId[]`, `active` (bool), `userId[]`/`ownerUserId[]`/`recruiterUserId[]`,
  `createdAt`/`updatedAt`/`closedAt` (date filters), `sort`, `fields` (extras: recruiters,
  statistics, partnerActions), `offset`, `limit` (max 1000)

```http
GET /jobs?active=true&limit=100&sort=-updatedAt
Authorization: Bearer {access_token}
```

**Success response shape:** `{ "items": [...], "totalCount": n, "links": { "first", "prev", "next", "last" } }`

#### Endpoint: GET /candidates (find candidates)

- **Key params:** `candidateId[]`, `name`, `email`, `phone`, **`keywords` (searches the latest
  resume text)**, `statusId[]`, `recruiterUserId[]`, `createdAt`/`updatedAt` filters, `sort`,
  `fields`, `offset`, `limit`

#### Other critical paths

- `GET /applications` · `GET /jobs/{jobId}/applications[/active]` — pipeline queries; stages
  via `GET /applications/lists/workflow`
- `GET /placements` · `GET /jobs/{jobId}/placements/approved` — placement reporting
- `POST /jobs` (201) · `PUT /jobs/{jobId}` · `PUT /jobs/{jobId}/status` (**202 async**)
- `POST /candidates` · `PUT /candidates/{candidateId}` — **409 on duplicate email**
- `POST /{entity}/{id}/notes` — typed notes on all six major entities; the lowest-risk write
  (note types via `/{entity}/lists/notetype`)

### 4.2 Full Endpoint Index (group level) [SPEC-community]

| Group         | Paths | Coverage                                                                  |
| ------------- | ----- | -------------------------------------------------------------------------- |
| jobs          | 18    | CRUD, status, applications, placements, notes, attachments, submissions, custom fields, status/source/notetype lists |
| candidates    | 28    | CRUD, status, applications, availability, skills, photo, videos, floats, notes, attachments, privacy delete, lists |
| applications  | 16    | find, get, update, status, review cycle (submit/accept/reject), workflow, notes, attachments, custom fields |
| placements    | 17    | find, get, update, status, notes, attachments, lists (awards, billing terms, industry codes, payment types) |
| companies     | 27    | CRUD, status, addresses, contacts, jobs, notes, attachments, lists        |
| contacts      | 17    | CRUD, status, notes, attachments, lists                                   |
| requisitions  | 10    | CRUD, submit/approve/reject, history, notes, attachments                  |
| partners      | 30    | Partner actions per entity (out of Numa scope)                            |
| jobads / jobboards | 8 | Find/get/update draft ads; job-board partner surface (partner_jobboard) |
| users         | 6     | find, **current**, get, photo, usergroups, usertasks                      |
| notes / submissions / floats / usertasks | 10 | Global notes, CV submissions, floats, tasks |
| usergroups / useroffices | 6 | Org structure                                                  |
| categories / countries / locations / worktypes | 4 | Reference taxonomies               |

**Deprecated endpoints:** none documented [UNKNOWN — no public changelog; the mirror may
itself lag the live API].

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability              | Supported?    | Syntax                                          | Notes                                            |
| ----------------------- | ------------- | ------------------------------------------------ | ------------------------------------------------- |
| Filter by id(s)         | yes           | `jobId=1&jobId=2` (repeatable array params)      | Most id filters accept multiples [SPEC-community] |
| Filter by field value   | yes           | per-endpoint named params (`name`, `email`, …)   | Exact grammar per endpoint in the spec            |
| Filter by date range    | **yes**       | `updatedAt=>2026-06-01&updatedAt=<2026-06-08`    | `>`/`<` prefixes, inclusive; repeat for range [SPEC-community] |
| Full-text search        | partial       | `keywords` on `/candidates` (searches latest resume) | No global search endpoint [UNKNOWN]          |
| Sort                    | yes           | `sort=-updatedAt` (multi-field, `-` = desc)      | Sortable fields enumerated per endpoint           |
| Field expansion         | yes           | `fields=recruiters&fields=statistics`            | Opt-in extras per endpoint                        |
| Count only              | yes           | `limit=0`                                        | Returns just `totalCount` [SPEC-community]        |
| Aggregations            | no            | compute client-side                              | —                                                 |

### 5.2 Common Query Patterns [REQUIRED]

```http
# 1 — who am I / connection probe
GET /users/current
# 2 — open jobs, most recently updated first
GET /jobs?active=true&sort=-updatedAt&limit=100
# 3 — resolve account taxonomies (do once, cache)
GET /jobs/lists/status
GET /applications/lists/workflow
# 4 — candidates updated this week (change polling); resume keyword search
GET /candidates?updatedAt=>2026-06-03&sort=-updatedAt&limit=100
GET /candidates?keywords=python+aws&limit=20
# 5 — a job's active applications; approved placements; count-only probe
GET /jobs/{jobId}/applications/active
GET /jobs/{jobId}/placements/approved
GET /placements?limit=0          → totalCount only
```

(All with `Authorization: Bearer {access_token}` — injected by the Numa backend.)

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** offset/limit with hypermedia links [SPEC-community]
- **Parameters:** `offset` (index of first entry) + `limit` (max per page; **max 1000**;
  `0` = count only) [SPEC-community]
- **Default page size:** not stated in the mirror [UNKNOWN — observe live; assume modest]
- **Total count:** **always available** as `totalCount`

**Response structure:** `{ "items": [...], "totalCount": n, "links": { "first", "prev", "next", "last" } }`
— `links.next` is a ready-made URL for the next page [SPEC-community]

**How to detect last page:** `links.next` absent, or `offset + items.length >= totalCount`

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /candidates?limit=100
        → { items: [100], totalCount: 480, links: { next: ".../candidates?offset=100&limit=100", ... } }
Page 2: GET links.next  (or /candidates?offset=100&limit=100)
Page 5: items: [80], links.next absent → stop
```

> Offset paging can skip/duplicate rows if the collection mutates mid-walk — for change syncs
> prefer `updatedAt=>` filters with `sort=updatedAt` over deep offset walks.

### 6.3 Bulk Operations [IMPORTANT]

- No batch/bulk endpoints found [UNKNOWN — nothing in the 197 mirror paths]. Writes are one-at-a-time; space loops and back off on 429.

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                      | Supported?         | Notes                                                              |
| ------------------------------ | ------------------ | -------------------------------------------------------------------|
| Webhooks                       | **yes** [DOCS]     | Official Webhooks KB article exists; subscriptions reportedly managed via the API. Detail is 403-walled and absent from the community mirror — event types, payloads, signatures, and retries all [UNKNOWN]. |
| WebSocket / SSE / long polling | no                 | Not documented. (Partner actions / `partner_ui_action` are UI buttons, not an event feed.) |

### 7.2 Webhooks [IMPORTANT]

Documented to exist [DOCS — Zendesk article 360022511513] but the article is not fetchable
headlessly and the mirror omits webhook endpoints. Before any event-driven feature: log into
the KB / Developer Centre and capture event types, the subscription API, payload shape, and
signature scheme. **Do not design against guessed payloads.**

### 7.4 Polling Fallback [IMPORTANT]

JobAdder is unusually well-suited to polling: every major list endpoint filters on
`updatedAt`/`createdAt` with `>` prefixes — poll
`GET /{resource}?updatedAt=>{lastSync}&sort=updatedAt&limit=100`; `limit=0` count probes give
cheap deltas. Rate budget unknown (Phase 8) — keep cadence conservative, back off on 429.

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope  | Limit         | Window | Notes                                                       |
| ------ | ------------- | ------ | ------------------------------------------------------------ |
| Global | **[UNKNOWN]** | —      | No numeric thresholds in any retrievable source. The walled KB may document per-account limits — check on first credentialed access. |

- **Headers:** [UNKNOWN] — capture `X-RateLimit-*` / `Retry-After` on the first credentialed
  call. **Backoff:** treat 429 as authoritative — 1s → 5s → 30s → 2m with jitter; space
  page-walks (~1s) [UNVERIFIED — defensive default]

### 8.2 Error Handling [REQUIRED]

**Standard error response format: [UNKNOWN — needs live testing.]** The mirror documents
status codes per endpoint but no error body schema. Parse defensively: status code first,
then try JSON, fall back to raw text.

**Status codes documented in the mirror** [SPEC-community] (success: 200, 201 created,
204 no-content deletes):

| HTTP Status | Meaning                                                    | Retryable? | Recovery                                                  |
| ----------- | ----------------------------------------------------------- | ---------- | ----------------------------------------------------------|
| 202         | **Accepted — async status transitions** (`PUT */status`, review/approve ops) | — | Re-read the entity to confirm the transition landed |
| 401         | Auth failed (expired/revoked token) [UNVERIFIED]            | After refresh | Refresh; re-consent if refresh fails                    |
| 403         | Scope missing [UNVERIFIED]                                  | No         | Re-consent with correct scopes — not a refresh             |
| 404         | Not found (documented per endpoint, e.g. "Job was not found") | No       | Verify id/path                                             |
| 409         | **Duplicate** (candidate email, company name, application)  | No         | Look up the existing record; update instead of create      |
| 422         | Validation error                                            | No         | Fix field values                                           |
| 429         | Rate limited [UNVERIFIED — standard]                        | Yes        | Backoff per 8.1                                            |
| 5xx         | Server error                                                | Cautiously | Retry once with backoff                                    |

### 8.3 Idempotency & Async [IMPORTANT]

- **Idempotency key support:** none found [UNKNOWN]. GET idempotent; PUT-by-id safe to
  re-send. **POST retries risk duplicates** — but the 409 duplicate guards (candidate email,
  company name, application) act as a partial natural idempotency net. After a write timeout,
  **query before retrying** (e.g. find the candidate by email).
- **Status transitions are async (202)** — `PUT /{entity}/{id}/status`, application
  review/accept/reject, requisition approve/reject/submit. No polling handle is documented;
  re-read the entity after a short delay to confirm, and never re-fire a 202 transition [SPEC-community]

### 8.5 File Handling [NICE-TO-HAVE]

- **Attachments:** per-entity `POST /{entity}/{id}/attachments/{attach}` consuming
  `multipart/form-data` or `application/octet-stream` (`fileData` param); categories via
  `/{entity}/lists/attachmentcategory`; download via GET on the same path [SPEC-community].
  Upload mechanics untested — verify before exposing through Numa.

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

**Selected integration path:** **Direct API via the Numa native data connector (`request`
operation)** — registry `authType: oauth2`, NOT Pipedream, NOT a Files connector (ATS
records, not documents).

**Justification:** JobAdder is OAuth2-only, and Numa's standard OAuth machinery covers it
with **zero new auth code**: OAuthWizard captures the Developer Centre app's client id/secret
(`oauth-client-jobadder`); users consent via the standard redirect flow; `get_oauth_token`
injects the Bearer token and auto-refreshes the 60-minute access tokens. No version headers,
no tenant-id captures, no custom auth schemes.

**Numa request flow:**

```
workspace agent → connectors(name="request", params={connector: "jobadder",
                    url: "https://api.jobadder.com/v2/jobs?active=true&limit=100", method: "GET"})
  → backend fetches/refreshes the user's OAuth token (oauth-jobadder user secret)
  → injects Authorization: Bearer {access_token} → forwards; the agent never sees the token
```

> ⚠️ **Base-URL wiring note:** the registry carries `baseUrl: 'https://api.jobadder.com/v2'`,
> but the OAuthWizard does not persist a `base_url` vault field (only the ApiKeyWizard does),
> and `_resolve_connector_base_url` reads only vault fields — so **agents must use absolute
> URLs** (`https://api.jobadder.com/v2/...`). The token response's account-specific `api`
> field is also not captured today — if a tenant ever reports a non-default host, store it as
> `api_endpoint` on `oauth-client-jobadder`. See `03-connector-setup.md` §5.

### 9.2 Connector Requirements [IMPORTANT]

- **Auth type:** `oauth2` — admin-supplied client id/secret (company secret) + per-user OAuth
  grants via the redirect flow. **No chat credential card** — OAuth connectors connect via
  browser redirect.
- **Per-client config:** none beyond the OAuth app — fixed SaaS host; scopes
  `read write offline_access` from the registry
- **Category:** Recruitment — **Caching:** standard project-management preset
- **JobAdder-side prerequisite:** a Developer Centre application with the Numa redirect URI

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Recruitment reporting: open jobs, candidate pipelines, application stages, placements,
   consultant (user) activity, company/contact lookups — with offset pagination + totalCount
2. Change-window queries via `updatedAt=>`/`createdAt=>` date filters and `sort`;
   resume keyword search (`/candidates?keywords=`)
3. Resolve account taxonomies first (status lists, application workflow, note types) and
   translate ids to names before answering
4. Create/update records on explicit user request: notes (lowest risk), candidates
   (handle 409 duplicates by updating), jobs, status transitions (202 → re-read to confirm)
5. Connection diagnostics via `GET /users/current`

**CANNOT do (out of scope or dangerous — encode in LLM rules):**

1. `DELETE /candidates/{id}/privacy` (permanent GDPR erasure) — never without explicit human
   confirmation; same for any DELETE
2. Set the `Authorization` header itself (backend-injected)
3. Submit applications to job boards or drive partner actions (partner scopes not requested);
   configure webhooks (detail unknown — Phase 7)
4. Hammer the API (budget unknown — space page-walks, back off on 429); blind-retry POSTs
   after timeouts — query for the record first (409 guards help)

**Default parameters:**

| Parameter | Default                          | Reason                                          |
| --------- | -------------------------------- | ------------------------------------------------ |
| `limit`   | 100 (max 1000)                   | Balanced page size; `0` for count-only probes    |
| `sort`    | `-updatedAt` on list queries     | Most-recent-first matches typical questions      |
| URL form  | absolute `https://api.jobadder.com/v2/...` | Base-URL wiring note in 9.1            |

### 9.4 SDK / MCP Assessment [NICE-TO-HAVE]

No official SDKs and no MCP server exist — raw REST via the generic `request` proxy is the
only surface. The community OpenAPI mirror is useful as an endpoint reference but is
third-party [SPEC-community]; re-validate field-level detail before building writes.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 **partially**: auth model fully documented; **authenticated first-call gate NOT passed (no credentials)**
- [x] Phase 3 complete: core entities + relationships + state machines + business rules
- [x] Phase 4 complete: critical endpoints exact; full 197-path index (community mirror)
- [x] Phases 5–6 complete: filter grammar (date prefixes, sort, fields, keywords) + offset/limit pagination
- [x] Phase 7 partial: webhooks exist but detail walled → polling-first for Numa
- [ ] Phase 8 **partially**: status codes mapped; **rate limits and error bodies [UNKNOWN]**
- [x] Phase 9 complete: integration path selected (Direct API, oauth2 connector) + wiring caveats

**Overall investigation confidence:** **medium** — auth, pagination, filtering, and the
endpoint catalog are solid, but zero authenticated validation, unknown rate limits/error
bodies, walled webhook docs, and reliance on a third-party spec snapshot cap it.

**Known gaps that will reduce output quality:**

1. **No authenticated call ever made** — error bodies, rate-limit headers, default page size, live envelopes
2. **Webhook mechanics entirely walled** — event types, payloads, signatures unknown
3. **Community mirror staleness** — field-level schemas may lag the live API
4. **Account-specific `api` base URL** — whether non-default hosts occur in practice
5. **Exact 401/403 semantics** for expired tokens vs missing scopes

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire (templates in `ext-api-doc/_templates/`):
**01-llm-api-rules** (Phases 2/4/8/9 — open with the not-live-validated banner; mandate
absolute URLs, taxonomy resolution before filtering, 202 re-read pattern, human confirmation
for deletes/privacy erasure) · **01a-domain-model-reference** (Phase 3) ·
**01b-query-patterns** (Phases 5–6) · **01c-mutation-patterns** (Phases 3.4 + 4 + 8.3:
409 duplicates, 202 transitions, notes-first writes) · **01d-event-and-error-handling**
(Phases 7–8: polling via updatedAt, defensive error parsing) · **02-api-spec-investigation**
(all phases condensed) · **03-connector-setup** (Phase 9 — real registry/wizard/backend
wiring) · **04-connection-and-reauth** (Phase 2.3 + lifecycle: 60-min tokens, refresh
rotation, revoked grant → 401 → reconnect via OAuth redirect, 403 = scope).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                      |
| ---------------------------- | ------------- | ----------- | ----------------------------------------------------------|
| 01-llm-api-rules             | yes           | medium      | Error bodies + rate limits unknown                        |
| 01a-domain-model-reference   | yes           | medium-high | Models from mirror; enums are per-account lists           |
| 01b-query-patterns           | yes           | medium-high | Filter/sort/paging grammar well documented                |
| 01c-mutation-patterns        | yes           | medium      | 409/202 semantics solid; validation error shapes unknown  |
| 01d-event-and-error-handling | yes           | medium      | Polling clear; webhooks walled; error bodies unknown      |
| 02-api-spec-investigation    | yes           | medium      | Community-mirror provenance; no live validation           |
| 03-connector-setup           | yes           | high        | Standard OAuth connector; wiring is real code             |
| 04-connection-and-reauth     | yes           | high        | OAuth lifecycle fully documented by the vendor            |

---

_Compiled 2026-06-10 from the official JobAdder OAuth2 article, the API portal, and the
community OpenAPI mirror. **No authenticated call has been made — re-validate flagged items
with a real OAuth grant before first customer use.**_
