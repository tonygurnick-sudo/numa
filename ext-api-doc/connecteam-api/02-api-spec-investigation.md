---
api_name: Connecteam (API Key)
api_slug: connecteam-api
base_url: https://api.connecteam.com
path_version_segment: per-module (/users/v1, /time_clock/v1, /scheduler/v1 + /scheduler/v2, /jobs/v1, /forms/v1, /settings/v1); NO global /v1; /me is unprefixed
path_style: underscores not hyphens
call_surface: HTTP via `numa integrations request` (connect_request proxy); NOT a Files connector
auth: X-API-KEY header (static account key; NOT Authorization: Bearer)
field_casing: camelCase
spec_format: none publicly located; developer.connecteam.com/llms.txt enumerates ~110 endpoints
docs_url: https://developer.connecteam.com
shared_api: same REST API as connecteam-oauth — ONLY the Authentication section differs; keep this file consistent with connecteam-oauth/02
date_researched: 2026-05-29
confidence: [DOCUMENTED] vendor docs, [INFERRED], [UNKNOWN]. NO live call made — almost nothing is [CONFIRMED]; the CRITICAL GATE (live GET /me) is not passed; treat envelopes/error bodies/webhook payloads as [DOCUMENTED-shape]/[INFERRED]/[UNKNOWN].
---

# Connecteam (API Key) — API Specification & Investigation

Condensed developer reference for the Connecteam REST API.

## Overview

- **Vendor:** Connecteam Ltd. A deskless-workforce management platform (time clock, scheduling, digital forms, tasks, HR). REST API exposes Users, Time Clock activities & timesheets, Scheduler shifts (V1+V2), Forms & submissions, Jobs/sub-jobs, Attachments, Webhook subscriptions.
- **API version:** `v1`, versioned **per module** — `/users/v1`, `/time_clock/v1`, `/scheduler/v1` (+`/scheduler/v2`), `/jobs/v1`, `/forms/v1`, `/settings/v1`. **No** global `/v1` prefix. `/me` is the only unprefixed path.
- **Base URL:** `https://api.connecteam.com` (fixed — **no** instance/region field in the Numa registry).
- **API type:** REST (JSON over HTTPS). `Accept: application/json`, `Content-Type: application/json` on bodies. **Field casing:** camelCase (`userId`, `firstName`, `isArchived`, `assignedUserIds`).
- **Plan gate:** public API requires **Expert plan or higher**; **Forms API (and some others) Enterprise-only**.
- **Sandbox / status page / OpenAPI download:** None located [UNKNOWN]. `developer.connecteam.com/llms.txt` is the closest machine-readable index (~110 endpoints across 18 feature areas).

**Docs links [DOCUMENTED]:** portal [developer.connecteam.com](https://developer.connecteam.com) (ReadMe-hosted) · reference [/reference](https://developer.connecteam.com/reference) ("authoritative, real-time with production") · auth guides [API key](https://developer.connecteam.com/docs/authentication-1) + [OAuth 2.0](https://developer.connecteam.com/docs/oauth-20) · [changelog](https://developer.connecteam.com/changelog) · [help.connecteam.com](https://help.connecteam.com) (Forms/Jobs API) · [discuss](https://developer.connecteam.com/discuss) · [llms.txt](https://developer.connecteam.com/llms.txt).

## Authentication

> ⚠️ **The ONLY material divergence from `connecteam-oauth`.** Everything else identical. Full setup/rotation in `04-connection-and-reauth.md`.

### Method: API Key (`X-API-KEY` header)

Numa's registry: `authType: 'api-key'`, single credential field `api_token`. All calls flow through the `connect_request` proxy, which injects the stored key as `X-API-KEY` — agent never sees the raw key, no token exchange.

```
X-API-KEY: {api_token}
Accept: application/json
Content-Type: application/json     ← POST/PUT bodies only
```

> ⚠️ **NOT** `Authorization: Bearer …` — that is the OAuth (`connecteam-oauth`) path.

| Property          | Value                                                                    | Source                        |
| ----------------- | ------------------------------------------------------------------------ | ----------------------------- |
| Auth location     | HTTP **header** — `X-API-KEY: {key}`                                     | [DOCUMENTED]                  |
| How to obtain     | web app → **Settings → API Keys → Add API key** (account **owner** only) | [DOCUMENTED]                  |
| Key format        | Opaque secret string; treat as a password — never log/echo               | [DOCUMENTED]                  |
| Token lifetime    | **Does not expire** — static, indefinite (contrast OAuth's 24h)          | [DOCUMENTED]                  |
| Refresh mechanism | **None** — no exchange, no refresh, no `expires_in`                      | [DOCUMENTED]                  |
| Rotation          | Manual — create new key, delete old in Settings → API Keys               | [INFERRED — no API to rotate] |
| Rate limits       | Per **account**, not per key — multiple keys share one quota             | [DOCUMENTED]                  |
| Plan gate         | **Expert+**; Forms API **Enterprise-only**                               | [DOCUMENTED]                  |

**Smoke test:** `GET /me` (with `X-API-KEY`).

### OAuth auth (sibling `connecteam-oauth` — for cross-consistency)

| Parameter   | Value                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| Grant type  | `client_credentials` (server-to-server; no user redirect/consent)                    |
| Token URL   | `POST https://api.connecteam.com/oauth/v1/token` (HTTP Basic: clientId:clientSecret) |
| Header sent | `Authorization: Bearer {access_token}` (24h lifetime, no refresh token)              |
| Scopes      | `feature.permission`, e.g. `users.read`, `schedule.write`; immutable after creation  |

> The API-key path is materially simpler — the relay just attaches `X-API-KEY` and forwards; no token-mint/cache/refresh. The single error surface that differs in cause from OAuth: a bad/revoked key (401/403) vs a token-mint failure.

## Endpoint Catalog

> Identical to `connecteam-oauth`; only the auth header differs. Paths use **underscores** (`time_clock`, `form_submissions`), not hyphens.

### Identity

| Method | Path  | Purpose                     | Paginated | Idempotent |
| ------ | ----- | --------------------------- | --------- | ---------- |
| GET    | `/me` | Account/identity smoke test | No        | Yes        |

> The only endpoint **without** a module prefix. Use to confirm the key.

### Users (IDs are **integers**)

| Method | Path                       | Purpose                         | Paginated | Idempotent |
| ------ | -------------------------- | ------------------------------- | --------- | ---------- |
| GET    | `/users/v1/users`          | List users (filters)            | Yes       | Yes        |
| GET    | `/users/v1/users/{userId}` | Get single user [INFERRED]      | No        | Yes        |
| POST   | `/users/v1/users`          | Create users (batch ≤25)        | No        | No         |
| PUT    | `/users/v1/users`          | Update users (batch) [INFERRED] | No        | Yes        |
| DELETE | `/users/v1/users/{userId}` | Delete a user                   | No        | Yes        |
| DELETE | `/users/v1/users`          | Archive users (bulk)            | No        | Yes        |
| POST   | `/users/v1/admins`         | Promote user to admin           | No        | No         |

### Time Clock (IDs are **integers**)

| Method | Path                                              | Purpose                       | Paginated | Idempotent |
| ------ | ------------------------------------------------- | ----------------------------- | --------- | ---------- |
| GET    | `/time_clock/v1/time_clocks`                      | List time clocks              | Yes       | Yes        |
| GET    | `/time_clock/v1/time_clocks/{id}/time_activities` | List activities (≤92-day win) | Yes       | Yes        |
| POST   | `/time_clock/v1/time_clocks/{id}/time_activities` | Create time activities        | No        | No         |
| PUT    | `/time_clock/v1/time_clocks/{id}/time_activities` | Update time activities        | No        | Yes        |
| POST   | `/time_clock/v1/time_clocks/{id}/clock_in`        | Real-time clock-in            | No        | No         |
| POST   | `/time_clock/v1/time_clocks/{id}/clock_out`       | Real-time clock-out           | No        | No         |
| GET    | `/time_clock/v1/time_clocks/{id}/timesheet`       | Aggregated payroll summary    | Yes       | Yes        |
| GET    | `/time_clock/v1/time_clocks/{id}/manual_breaks`   | Manual breaks                 | Yes       | Yes        |

> Time-activity queries limited to a **92-day** window — wider `startDate`/`endDate` rejected. `startDate`/`endDate` are `YYYY-MM-DD`; activity `start`/`end` timestamps are Unix **seconds**. Archived time clocks ARE returned by the list endpoint (historical data readable; new entries can't be created against an archived clock).

### Scheduler (shift IDs are **24-char hex strings**, e.g. `6784dacb3c07733b0a849f49`)

| Method | Path                                                            | Purpose                   | Paginated | Idempotent |
| ------ | --------------------------------------------------------------- | ------------------------- | --------- | ---------- |
| GET    | `/scheduler/v1/schedulers`                                      | List schedulers           | Yes       | Yes        |
| GET    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | List shifts (filters)     | Yes       | Yes        |
| GET    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts/{shiftId}`         | Get single shift          | No        | Yes        |
| POST   | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Create shifts (≤500)      | No        | No         |
| PUT    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Update shifts (bulk)      | No        | Yes        |
| DELETE | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Delete shifts (bulk ≤20)  | No        | Yes        |
| GET    | `/scheduler/v1/schedulers/{sid}/shift_layers`                   | List shift layers         | Yes       | Yes        |
| GET    | `/scheduler/v1/schedulers/{sid}/custom_fields`                  | Shift custom fields       | Yes       | Yes        |
| GET    | `/scheduler/{v1\|v2}/schedulers/user_unavailability`            | User unavailabilities     | Yes       | Yes        |
| POST   | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts_auto_assign`       | Start auto-assign (async) | No        | No         |
| GET    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts_auto_assign/{rid}` | Poll auto-assign result   | No        | Yes        |

> **Two API versions concurrent — V1 and V2.** V2 newer; default to **V2** for new work per the docs' migration guidance, but V1 remains available. `GET /shifts` **requires** `startTime`+`endTime` (Unix seconds); **overlapping** shifts returned. Auto-assign is the only async/polling pattern in the whole API.

### Jobs (IDs are **UUID strings**, e.g. `9fdebf1f-0c69-4914-89d2-8f86c3e5f47d`)

| Method | Path                     | Purpose                | Paginated | Idempotent |
| ------ | ------------------------ | ---------------------- | --------- | ---------- |
| GET    | `/jobs/v1/jobs`          | List jobs / sub-jobs   | Yes       | Yes        |
| GET    | `/jobs/v1/jobs/{jobId}`  | Get a job              | No        | Yes        |
| POST   | `/jobs/v1/jobs`          | Create job             | No        | No         |
| PUT    | `/jobs/v1/jobs/{jobId}`  | Update job             | No        | Yes        |
| DELETE | `/jobs/v1/jobs/{jobId}`  | Delete job (soft)      | No        | Yes        |
| GET    | `/jobs/v1/custom_fields` | Resource custom fields | Yes       | Yes        |

> Jobs use `isDeleted` soft-delete with an `includeDeleted` filter; sub-jobs via `parentId`.

### Forms (Enterprise-plan only)

| Method | Path                                             | Purpose                    | Paginated | Idempotent |
| ------ | ------------------------------------------------ | -------------------------- | --------- | ---------- |
| GET    | `/forms/v1/forms`                                | List forms                 | Yes       | Yes        |
| GET    | `/forms/v1/forms/{formId}`                       | Get a form                 | No        | Yes        |
| GET    | `/forms/v1/forms/{formId}/form_submissions`      | List submissions (filters) | Yes       | Yes        |
| GET    | `/forms/v1/forms/{formId}/form_submissions/{id}` | Get single submission      | No        | Yes        |
| PUT    | `/forms/v1/forms/{formId}/form_submissions/{id}` | Update manager fields only | No        | Yes        |

> Only **manager fields** (person/status/note/date) writable on a submission; answer entries read-only. Dropdown-question options under `/forms/v1/forms/{formId}/questions/{questionId}` support full CRUD.

### Attachments, Webhooks, other modules

| Method              | Path                                             | Purpose                       |
| ------------------- | ------------------------------------------------ | ----------------------------- |
| POST                | `/attachments/v1/files/generate_upload_url`      | Pre-signed upload URL         |
| PUT                 | `/attachments/v1/files/complete_upload/{fileId}` | Finalise upload               |
| POST                | `/attachments/v1/files/download_url`             | Pre-signed download URL       |
| GET                 | `/settings/v1/webhooks`                          | List webhook subscriptions    |
| POST                | `/settings/v1/webhooks`                          | Create a webhook subscription |
| GET/POST/PUT/DELETE | `/tasks/v1/taskboards/{id}/tasks`                | Tasks + sub-tasks CRUD        |
| GET                 | `/time_off/v1/...`                               | Time-off policies/balances    |

### Full Endpoint Index

From `developer.connecteam.com/llms.txt` (~110 endpoints across 18 feature areas). All require `X-API-KEY`; offset/limit pagination on list endpoints. Long tail (sales, onboarding, chat, publishers, assets, pay rates, company policies, smart groups, custom-field categories) exists in the same shape.

| #   | Method              | Path                                                            | Purpose                            | Confidence   |
| --- | ------------------- | --------------------------------------------------------------- | ---------------------------------- | ------------ |
| 1   | GET                 | `/me`                                                           | Identity smoke test                | [DOCUMENTED] |
| 2   | POST                | `/oauth/v1/token`                                               | OAuth token (OAuth connector only) | [DOCUMENTED] |
| 3   | GET                 | `/users/v1/users`                                               | List users                         | [DOCUMENTED] |
| 4   | POST                | `/users/v1/users`                                               | Create users (≤25)                 | [DOCUMENTED] |
| 5   | GET                 | `/users/v1/users/{userId}`                                      | Get user                           | [INFERRED]   |
| 6   | PUT                 | `/users/v1/users`                                               | Update users                       | [INFERRED]   |
| 7   | DELETE              | `/users/v1/users/{userId}`                                      | Delete user                        | [DOCUMENTED] |
| 8   | DELETE              | `/users/v1/users`                                               | Archive users (bulk)               | [DOCUMENTED] |
| 9   | POST                | `/users/v1/admins`                                              | Promote to admin                   | [DOCUMENTED] |
| 10  | GET/POST/PUT/DELETE | `/users/v1/smart_groups[/{id}]`                                 | Smart groups CRUD                  | [DOCUMENTED] |
| 11  | GET/POST/PUT/DELETE | `/users/v1/custom_fields[...]`                                  | User custom fields CRUD            | [DOCUMENTED] |
| 12  | GET                 | `/time_clock/v1/time_clocks`                                    | List time clocks                   | [DOCUMENTED] |
| 13  | GET                 | `/time_clock/v1/time_clocks/{id}/time_activities`               | List activities (≤92d)             | [DOCUMENTED] |
| 14  | POST                | `/time_clock/v1/time_clocks/{id}/time_activities`               | Create activities                  | [DOCUMENTED] |
| 15  | PUT                 | `/time_clock/v1/time_clocks/{id}/time_activities`               | Update activities                  | [DOCUMENTED] |
| 16  | POST                | `/time_clock/v1/time_clocks/{id}/clock_in`                      | Clock in                           | [DOCUMENTED] |
| 17  | POST                | `/time_clock/v1/time_clocks/{id}/clock_out`                     | Clock out                          | [DOCUMENTED] |
| 18  | GET                 | `/time_clock/v1/time_clocks/{id}/timesheet`                     | Timesheet summary                  | [DOCUMENTED] |
| 19  | GET                 | `/scheduler/v1/schedulers`                                      | List schedulers                    | [DOCUMENTED] |
| 20  | GET                 | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | List shifts                        | [DOCUMENTED] |
| 21  | POST                | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Create shifts (≤500)               | [DOCUMENTED] |
| 22  | PUT                 | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Update shifts                      | [DOCUMENTED] |
| 23  | DELETE              | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Delete shifts (≤20)                | [DOCUMENTED] |
| 24  | GET                 | `/scheduler/v1/schedulers/{sid}/shift_layers`                   | List shift layers                  | [DOCUMENTED] |
| 25  | GET                 | `/scheduler/{v1\|v2}/schedulers/user_unavailability`            | User unavailabilities              | [DOCUMENTED] |
| 26  | POST                | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts_auto_assign`       | Start auto-assign                  | [DOCUMENTED] |
| 27  | GET                 | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts_auto_assign/{rid}` | Poll auto-assign                   | [DOCUMENTED] |
| 28  | GET/POST/PUT/DELETE | `/jobs/v1/jobs[/{jobId}]`                                       | Jobs CRUD                          | [DOCUMENTED] |
| 29  | GET                 | `/jobs/v1/custom_fields`                                        | Resource custom fields             | [DOCUMENTED] |
| 30  | GET                 | `/forms/v1/forms[/{formId}]`                                    | Forms                              | [DOCUMENTED] |
| 31  | GET                 | `/forms/v1/forms/{formId}/form_submissions`                     | List submissions                   | [DOCUMENTED] |
| 32  | PUT                 | `/forms/v1/forms/{formId}/form_submissions/{id}`                | Update manager fields              | [INFERRED]   |
| 33  | GET/POST/PUT/DELETE | `/tasks/v1/taskboards/{id}/tasks[...]`                          | Tasks + sub-tasks                  | [DOCUMENTED] |
| 34  | GET                 | `/time_off/v1/...`                                              | Time-off policies/balances         | [DOCUMENTED] |
| 35  | POST                | `/attachments/v1/files/generate_upload_url`                     | File upload (step 1)               | [DOCUMENTED] |
| 36  | GET/POST/PUT/DELETE | `/settings/v1/webhooks[/{webhookId}]`                           | Webhook CRUD                       | [DOCUMENTED] |

## Data Models

> Field names from reference overview pages; types [INFERRED] where the JSON schema sits behind ReadMe's "Try It" widget. **Forward-compatible schemas:** new fields may appear in responses — parse leniently.

### User (Employee)

| Field          | Type              | Required | Writable | Description                      | Example              |
| -------------- | ----------------- | -------- | -------- | -------------------------------- | -------------------- |
| userId         | integer           | yes      | no       | Unique id                        | `7031021`            |
| firstName      | string            | yes      | yes      | Given name                       | `"Omer"`             |
| lastName       | string            | yes      | yes      | Family name                      | `"Vered"`            |
| phoneNumber    | string (E.164)    | yes      | yes      | Login identity (phone-led)       | `"+9720548888888"`   |
| email          | string            | no       | yes      | Email                            | `"user@example.com"` |
| userType       | enum              | yes      | no       | `owner`/`admin`/`manager`/`user` | `"owner"`            |
| isArchived     | boolean           | yes      | no       | Archived state                   | `false`              |
| smartGroupsIds | array<integer>    | no       | yes      | Smart group memberships          | `[2359154,2359155]`  |
| customFields   | array<object>     | no       | yes      | Tenant-defined custom fields     | see below            |
| createdAt      | integer (epoch s) | yes      | no       | Creation ts (Unix **seconds**)   | `1712573537`         |
| modifiedAt     | integer (epoch s) | yes      | no       | Last-modified ts                 | `1723640035`         |
| lastLogin      | integer (epoch s) | no       | no       | Last login                       | `1723640035`         |

Custom field shape: `{"customFieldId":6208755,"name":"Title","type":"str","value":"Solution Engineer"}`
Relationships: a User is the `assignedUserId` on Shifts, the `userId` on Time Activities, and the submitter of Form Submissions.

### Time Activity (Shift / Manual break / Time-off)

| Field          | Type              | Required | Writable     | Description                          | Example          |
| -------------- | ----------------- | -------- | ------------ | ------------------------------------ | ---------------- |
| id             | string            | yes      | no           | Activity/shift id                    | `"shift-abc123"` |
| userId         | integer           | yes      | yes (create) | Employee                             | `9170357`        |
| start          | object            | yes      | yes          | `{timestamp,timezone,locationData?}` | see below        |
| end            | object            | yes      | yes          | `{timestamp,timezone,locationData?}` | see below        |
| jobId          | string (UUID)     | no       | yes          | Associated job                       | `"job-123"`      |
| employeeNote   | string            | no       | yes          | Employee note                        | `"Imported"`     |
| managerNote    | string            | no       | yes          | Manager note                         | `""`             |
| isAutoClockOut | boolean           | no       | no           | Was auto-clocked-out                 | `false`          |
| createdAt      | integer (epoch s) | yes      | no           | Creation ts                          | `1704110400`     |

start/end object: `{"timestamp":1704110400,"timezone":"America/New_York","locationData":{...}}`
Relationships: belongs to a Time Clock (path `timeClockId`), references a User by `userId`. An activity with no closing `end` is "open" (clocked-in).

### Shift

| Field           | Type              | Required | Writable | Description                    | Example                                  |
| --------------- | ----------------- | -------- | -------- | ------------------------------ | ---------------------------------------- |
| id              | string (hex)      | yes      | no       | Shift id (24-char hex)         | `"6784dacb3c07733b0a849f49"`             |
| title           | string            | no       | yes      | Shift name                     | `"Morning Shift"`                        |
| assignedUserIds | array<integer>    | no       | yes      | Assigned employee ids          | `[9170357]`                              |
| startTime       | integer (epoch s) | yes      | yes      | Shift start (Unix **seconds**) | `1736924400`                             |
| endTime         | integer (epoch s) | yes      | yes      | Shift end                      | `1736953200`                             |
| jobId           | string (UUID)     | no       | yes      | Associated job                 | `"d4ad7232-576f-2ff6-c57d-8240f1089b00"` |
| isPublished     | boolean           | yes      | yes      | Visible to employees           | `true`                                   |
| isOpenShift     | boolean           | yes      | yes      | Claimable / unassigned         | `false`                                  |
| color           | string (#RRGGBB)  | no       | yes      | Hex colour                     | `"#4B7AC5"`                              |

Relationships: belongs to a Scheduler (path `schedulerId`); `assignedUserIds` → Users; `jobId` → Job (UUID).

### Job (resource)

| Field       | Type           | Required | Writable | Description                        | Example                                  |
| ----------- | -------------- | -------- | -------- | ---------------------------------- | ---------------------------------------- |
| jobId       | string (UUID)  | yes      | no       | Unique id                          | `"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d"` |
| title       | string         | yes      | yes      | Job name                           | `"Delivery Driver"`                      |
| code        | string         | no       | yes      | Job code                           | `"DD-001"`                               |
| color       | string         | no       | yes      | Hex colour                         | `"#3968BB"`                              |
| gps         | object         | no       | yes      | `{address,longitude,latitude}`     | see below                                |
| isDeleted   | boolean        | yes      | no       | Soft-deleted state                 | `false`                                  |
| assign      | object         | no       | yes      | `{type,userIds[],groupIds[]}`      | `{"type":"both","userIds":[7031021]}`    |
| instanceIds | array<integer> | no       | yes      | Scheduler/time-clock ids job is on | `[6833518]`                              |
| parentId    | string         | no       | yes      | Parent job (sub-jobs)              | —                                        |

gps object: `{"address":"123 Main St","longitude":-73.93,"latitude":40.71}`

### Form Submission [partial — full schema not in public example]

| Field            | Type              | Writable | Description                                                |
| ---------------- | ----------------- | -------- | ---------------------------------------------------------- |
| formSubmissionId | string/integer    | no       | Unique submission id                                       |
| formId           | integer           | no       | Parent form                                                |
| userId           | integer           | no       | Submitting user                                            |
| submissionTime   | integer (epoch s) | no       | Submission ts                                              |
| answers          | array<object>     | no       | Question/answer entries (read-only)                        |
| status           | enum              | partial  | Manager field — writable via PUT (person/status/note/date) |

### Field-format reference

| Format        | Pattern                | Example                    | Notes                                         |
| ------------- | ---------------------- | -------------------------- | --------------------------------------------- |
| Timestamp     | Unix epoch **seconds** | `1712573537`               | Almost all time fields; rate-limit resets too |
| Date filter   | `YYYY-MM-DD`           | `2025-01-15`               | `time_activities` startDate/endDate           |
| Integer ID    | integer                | `7031021`                  | users, time clocks, schedulers, custom fields |
| UUID ID       | RFC4122 string         | `9fdebf1f-0c69-4914-...`   | jobs                                          |
| Hex/string ID | 24-char hex string     | `6784dacb3c07733b0a849f49` | scheduler shifts                              |
| Phone         | E.164                  | `+9720548888888`           | user login identity                           |
| Colour        | `#RRGGBB`              | `#4B7AC5`                  | shifts, jobs                                  |
| Timezone      | IANA tz name           | `"America/New_York"`       | start/end objects                             |

> **#1 integration bug:** Unix **seconds**, not ms, not ISO-8601, for all activity/shift times. **#2:** never coerce IDs — users/clocks/schedulers **integers**, jobs **UUID strings**, shifts **24-char hex strings**.

## Query Parameters

Filtering is **whitelisted per endpoint** — no generic query language. Array filters use repeated query params (`?userIds=1&userIds=2`); multiple distinct params AND-combined; no OR/nested filtering, full-text search, field selection, or `include`-style relation expansion. [DOCUMENTED params; AND-combination & no-search INFERRED]

### `GET /users/v1/users`

| Parameter      | Type            | Default  | Description                              |
| -------------- | --------------- | -------- | ---------------------------------------- |
| limit          | integer (1–500) | 10       | Page size                                |
| offset         | integer (≥0)    | 0        | Start position                           |
| sort           | string          | —        | Sort field (user creation time)          |
| order          | enum            | `asc`    | `asc`/`desc`                             |
| userIds        | array<int>      | —        | Filter by specific user ids              |
| userStatus     | enum            | `active` | `active`/`archived` (likely `all`)       |
| fullNames      | array<string>   | —        | Exact, **case-sensitive** name match     |
| phoneNumbers   | array<string>   | —        | E.164 phone match                        |
| emailAddresses | array<string>   | —        | Email match                              |
| createdAt      | integer (epoch) | —        | Users created after timestamp            |
| modifiedAt     | integer (epoch) | —        | Users modified after timestamp (polling) |

### `GET /jobs/v1/jobs`

| Parameter      | Type          | Default | Description               |
| -------------- | ------------- | ------- | ------------------------- |
| instanceIds    | array<int>    | —       | Scheduler/time-clock IDs  |
| jobIds         | array<string> | —       | Specific job UUIDs        |
| jobNames       | array<string> | —       | Job name match            |
| jobCodes       | array<string> | —       | Job code match            |
| includeDeleted | boolean       | `false` | Include soft-deleted jobs |
| sort           | string        | `title` | Sort field                |
| order          | enum          | `asc`   | `asc`/`desc`              |
| limit          | integer       | 10      | Page size (max 500)       |
| offset         | integer       | 0       | Start position            |

### `GET /time_clock/v1/time_clocks/{id}/time_activities`

| Parameter     | Type          | Default | Description                               |
| ------------- | ------------- | ------- | ----------------------------------------- |
| startDate     | `YYYY-MM-DD`  | —       | **Required.** Window start                |
| endDate       | `YYYY-MM-DD`  | —       | **Required.** Window end (range ≤92 days) |
| userIds       | array<int>    | —       | Filter by employee                        |
| jobIds        | array<string> | —       | Filter by job UUID                        |
| activityTypes | array<enum>   | —       | `shift`/`manual_break`/`time_off`         |

### `GET /scheduler/{v1|v2}/schedulers/{sid}/shifts`

| Parameter       | Type          | Default | Description                          |
| --------------- | ------------- | ------- | ------------------------------------ |
| startTime       | integer (s)   | —       | **Required.** Window start (epoch s) |
| endTime         | integer (s)   | —       | **Required.** Window end (epoch s)   |
| jobId           | array<string> | —       | Filter by job UUID                   |
| assignedUserIds | array<int>    | —       | Filter by assignee                   |
| isOpenShift     | boolean       | —       | Only open/claimable shifts           |
| isPublished     | boolean       | —       | Only published shifts                |
| limit           | integer       | 10      | Page size (max 500)                  |
| offset          | integer       | 0       | Start position                       |

## Pagination

- **Type:** offset/limit. **Default page size:** 10. **Max:** 500 (documented users+jobs; assume 500 elsewhere [INFERRED]).
- **Total count: NOT returned** — no `total`/`hasMore` field; `paging` only echoes an `offset`. Use the "fewer-than-limit" heuristic; last page = array shorter than `limit`.

| Parameter | Type    | Default | Description              |
| --------- | ------- | ------- | ------------------------ |
| limit     | integer | 10      | Items per page (max 500) |
| offset    | integer | 0       | Starting position        |

Success envelope `{requestId, data, paging?}`:

```json
{ "requestId": "req_8f3c1a", "data": { "users": [] }, "paging": { "offset": 0 } }
```

> ⚠️ **`paging` location is inconsistent.** Users → top-level `paging.offset`; jobs/shifts → nested `data.paging.offset`. Parsers must check both.

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items (full page → continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items (full page → continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items (< limit → LAST PAGE)
```

**Bulk caps:** users create/update ≤**25**; shift create ≤**500**; bulk shift delete ≤**20**. Per-item partial-failure reporting [UNKNOWN].

## Rate Limits

Limits are **per Connecteam account**, shared across **every** API client (this connector + any other integration + the OAuth connector) — **not** per key. On SBP's 5/min you throttle almost immediately.

| Scope (per account) | Per Minute | Per Day |
| ------------------- | ---------- | ------- |
| SBP plan            | 5          | 100     |
| Expert plan         | 100        | 10,000  |
| Enterprise plan     | 200        | 20,000  |

**Headers (six, all returned):** `x-ratelimit-minute-limit` (`100`), `x-ratelimit-minute-remaining` (`87`), `x-ratelimit-minute-reset` (`1745625660`, UTC epoch **seconds**), `x-ratelimit-day-limit` (`10000`), `x-ratelimit-day-remaining` (`9213`), `x-ratelimit-day-reset` (`1745712000`).

**When exceeded:** `HTTP 429 Too Many Requests`, body `{"detail":"Too many requests"}`. **No `Retry-After`** — compute the wait from `x-ratelimit-minute-reset`. A community report notes the API sometimes returns **200 with `x-ratelimit-*-remaining: 0` instead of 429** — trust the remaining headers. **Strategy:** exponential backoff + honour `*-reset`; proactively pause when `*-remaining` low; cache slow-changing list reads aggressively.

## Error Handling

Success envelope `{requestId, data, paging?}`; error shape uses a **`detail`** field. A comprehensive per-status table is **not published** (docs defer to the live API Reference), so 401/403/422 bodies are [INFERRED].

```json
{ "detail": "Too many requests" }
```

| Status | Meaning          | Retryable | Recovery                                                            |
| ------ | ---------------- | --------- | ------------------------------------------------------------------- |
| 200    | Success          | —         | —                                                                   |
| 400    | Bad request      | No        | Fix request parameters per `detail`                                 |
| 401    | Unauthorized     | No        | Invalid/revoked `X-API-KEY` — verify the key; not retryable         |
| 403    | Forbidden        | No        | Plan-gated (need Expert+/Enterprise) or feature not on plan (Forms) |
| 404    | Not found        | No        | Verify the id (int vs UUID vs hex) and the path module/version      |
| 422    | Validation error | No        | Fix the offending field(s) per `detail`                             |
| 429    | Rate limited     | Yes       | Back off using `x-ratelimit-minute-reset`; no `Retry-After`         |
| 5xx    | Server error     | Yes       | Retry with exponential backoff + jitter                             |

> **Auth note:** a bad/revoked `X-API-KEY` returns 401/403 (exact body unconfirmed). This is the **one** error surface whose cause differs from the OAuth connector (which fails at the token-mint step instead).

## Webhooks / Events

**Registration:** `POST /settings/v1/webhooks` (also creatable in the UI Integration Center). Managed by the same API; fires regardless of which auth method created it.

```json
{
  "name": "Numa form sync",
  "url": "https://example.com/hooks/connecteam",
  "featureType": "forms",
  "eventTypes": ["form_submission", "form_submission_edited"],
  "objectId": 6208755,
  "isDisabled": false,
  "secretKey": "my-shared-secret"
}
```

- `objectId` required for all feature types **except `users`**. `secretKey` optional (signature verification).

| featureType       | Event types                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_promoted` |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`             |
| `time_activity`   | `clock_in`, `clock_out`, `admin_add`, `admin_edit`, `admin_approved_add_request` |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created` |
| `tasks`           | `task_published`, `task_completed`                                               |

**Verification:** `secretKey` is for "webhook signature verification" — exact signature header/algorithm **not documented** [UNKNOWN]. **Retry policy:** fixed `retryLimit` of **3**. Ordering/dedup guarantees [UNKNOWN]. **Payload body shape: [UNKNOWN]** — per-feature `/docs/*-webhook` pages exist; exact payloads not captured.
**Polling fallback:** any list endpoint with a `modifiedAt` epoch-second filter (e.g. `GET /users/v1/users?modifiedAt=…`); poll every few minutes, respecting the per-account minute cap.

## Known Limitations

1. **No live-tested examples** — envelopes, error bodies (401/403/422), webhook payloads are [DOCUMENTED-shape]/[INFERRED]/[UNKNOWN]. CRITICAL GATE (live `GET /me`) not passed.
2. **Plan gating** — API needs Expert+; Forms Enterprise-only; SBP throttled to 5/min.
3. **Per-account rate limits shared across every key/client.**
4. **92-day cap** on time-activity queries — chunk into ≤90-day windows.
5. **No total count** — page until the array is shorter than `limit`.
6. **`paging` location varies** — top-level (users), nested under `data` (jobs/shifts).
7. **No `Retry-After` on 429** — compute the wait from `x-ratelimit-minute-reset`; API may also return 200 with `*-remaining: 0`.
8. **Mixed ID types** — int (users/clocks/schedulers), UUID (jobs), hex (shifts); never coerce.
9. **Module-versioned, underscore paths** — no global `/v1`.
10. **No full-text search, field selection, relation expansion, or idempotency keys** [INFERRED].
11. **Scheduler V1-vs-V2 exact response-shape differences** need the `/docs/scheduler-shifts-vision-*` pages [INFERRED — discovery needed].

## SDKs & Tooling

| SDK / Tool      | URL                                                                    | Notes                                            |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| (none official) | —                                                                      | Docs show raw `requests`/`fetch`/curl only       |
| Official MCP    | [/docs/mcp](https://developer.connecteam.com/docs/mcp)                 | MCP server for AI agents — informative reference |
| Pipedream app   | [pipedream.com/apps/connecteam](https://pipedream.com/apps/connecteam) | Pre-built actions/triggers                       |

**Postman collection:** none official located [UNKNOWN]. **OpenAPI spec:** not located as a single download; `llms.txt` is the closest machine-readable index.

## Integration Path Assessment

**Recommended path: Direct API via `connect_request`** (HTTP `numa integrations request`), NOT a Files connector.
**Why:** Connecteam exposes **records** (users, time activities, shifts, form submissions, jobs), not a browsable file tree — no `list_files`/`download_file` semantic to map onto (attachment endpoints peripheral). The proxy injects `api_token` as `X-API-KEY`. Mirrors spec-driven API connectors (simPRO, Fergus' Direct-API portion), not the file-browser providers (Drive/Gmail/OneDrive/Dropbox). Static-header auth (no exchange/refresh/expiry) makes this the simplest of the two Connecteam connectors.

| Files-connector method (NOT used here) | Feasibility                                |
| -------------------------------------- | ------------------------------------------ |
| list_files                             | none — no file/folder tree                 |
| download_file                          | none                                       |
| search_files                           | none — value filters on records, not files |
| get_file_metadata                      | none                                       |

_Sources: Connecteam developer portal (`llms.txt`, reference, authentication, pagination, rate-limiting, OAuth 2.0, read-users, get-jobs, time-clock-time-activities, scheduler-get-shifts, setting-up-webhook-via-api), help-centre API collection, discuss forum, Numa connector registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`). No live API call — CRITICAL GATE not passed._
