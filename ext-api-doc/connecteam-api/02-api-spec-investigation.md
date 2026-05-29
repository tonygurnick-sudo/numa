---
api_name: 'Connecteam (API Key)'
api_slug: 'connecteam-api'
base_url: 'https://api.connecteam.com'
version: 'per-module path versioning (v1; scheduler shifts also v2)'
spec_format: 'none publicly located (developer.connecteam.com/llms.txt enumerates every endpoint)'
spec_url: ''
docs_url: 'https://developer.connecteam.com'
date_researched: '2026-05-29'
---

# Connecteam (API Key) -- API Specification & Investigation

> Clean developer reference for the Connecteam REST API. This document is the condensed
> output of the investigation questionnaire -- everything a developer needs to integrate
> with this API, in one place.
>
> **Shared-API note:** This is the **same REST API** as the `connecteam-oauth` connector.
> The base URL, endpoint catalog, data models, query/filter, pagination, rate-limit, error, and
> webhook behaviour are **identical** between the two connectors — **only the Authentication
> section differs** (this connector sends a static `X-API-KEY` header; the OAuth connector mints a
> 24h `client_credentials` bearer token). Keep this file consistent with
> `connecteam-oauth/02-api-spec-investigation.md`; the only intended divergence is "Authentication".
>
> Confidence markers per the investigation: `[CONFIRMED]` (verified against a live call),
> `[DOCUMENTED]` (in official vendor docs), `[INFERRED]`, `[UNKNOWN]`. **No live API call was made**,
> so almost nothing here is `[CONFIRMED]`.

---

## Overview

- **Vendor:** Connecteam Ltd. [DOCUMENTED]
- **API version:** `v1`, versioned **per module** in the path — `/users/v1`, `/time_clock/v1`, `/scheduler/v1` (+ `/scheduler/v2`), `/jobs/v1`, `/forms/v1`, `/settings/v1`. There is **no** global `/v1` prefix. [DOCUMENTED]
- **Base URL:** `https://api.connecteam.com` (fixed — there is **no** instance/region field in the Numa registry). [DOCUMENTED — matches `connectorRegistry.ts`]
- **Sandbox URL:** None documented — testing uses a live account. [UNKNOWN]
- **API type:** REST (JSON over HTTPS) [DOCUMENTED]
- **Data format:** JSON; `Accept: application/json`, `Content-Type: application/json` on bodies. [DOCUMENTED]
- **Field casing:** camelCase throughout (`userId`, `firstName`, `isArchived`, `createdAt`, `assignedUserIds`). [DOCUMENTED]
- **Documentation:** [developer.connecteam.com](https://developer.connecteam.com) (ReadMe-hosted portal) [DOCUMENTED]
- **API reference:** [developer.connecteam.com/reference](https://developer.connecteam.com/reference) — "authoritative source, updated in real-time with production". [DOCUMENTED]
- **Auth guides:** [API key (`X-API-KEY`)](https://developer.connecteam.com/docs/authentication-1) · [OAuth 2.0](https://developer.connecteam.com/docs/oauth-20) [DOCUMENTED]
- **Changelog:** [developer.connecteam.com/changelog](https://developer.connecteam.com/changelog) [DOCUMENTED]
- **Help-centre API articles:** [help.connecteam.com](https://help.connecteam.com) (Forms / Jobs API collection) [DOCUMENTED]
- **Developer Q&A:** [developer.connecteam.com/discuss](https://developer.connecteam.com/discuss) [DOCUMENTED]
- **LLM endpoint index:** [developer.connecteam.com/llms.txt](https://developer.connecteam.com/llms.txt) — Markdown index enumerating ~110 endpoints across 18 feature areas. [DOCUMENTED]
- **OpenAPI spec:** Not located as a single download. ReadMe portals are usually OpenAPI-backed, but no public `openapi.json` URL was found; `llms.txt` is the closest machine-readable index. [INFERRED — discovery needed]
- **Status page:** None found. [UNKNOWN]

**Summary:** Connecteam is a deskless-workforce management platform (time clock, employee scheduling, digital forms, task management, HR). The REST API exposes Users (employees), Time Clock activities & timesheets, Scheduler shifts (V1 + V2), Forms & submissions, Jobs/sub-jobs, Attachments, and Webhook subscriptions. **The public API requires the Expert plan or higher; the Forms API (and some others) are Enterprise-only.** [DOCUMENTED]

---

## Authentication

> ⚠️ **This is the only material divergence from the `connecteam-oauth` connector.** Everything else
> in the two packages is identical. Full setup/rotation detail lives in `04-connection-and-reauth.md`.

### Method: API Key (`X-API-KEY` header)

Numa's registry classifies this connector as `authType: 'api-key'` with a single credential field
`api_token`. All calls flow through Numa's `connect_request` proxy, which injects the stored key as
the `X-API-KEY` header — the workspace agent never sees the raw key and there is no token exchange.

**Header format (every request):**

```
X-API-KEY: {api_token}
Accept: application/json
Content-Type: application/json     ← on POST/PUT bodies only
```

> ⚠️ This is **not** `Authorization: Bearer …`. That header is the OAuth (`connecteam-oauth`) path.
> Do **not** send a bearer token here.

| Property            | Value                                                                               | Source                        |
| ------------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| Auth location       | HTTP request **header** — `X-API-KEY: {key}`                                        | [DOCUMENTED]                  |
| How to obtain       | Connecteam web app → **Settings → API Keys → Add API key** (account **owner** only) | [DOCUMENTED]                  |
| Key format          | Opaque secret string; treat as a password — never log or echo                       | [DOCUMENTED]                  |
| Token lifetime      | **Does not expire** — static, indefinite (contrast OAuth's 24h token)               | [DOCUMENTED]                  |
| Refresh mechanism   | **None** — no exchange, no refresh, no `expires_in`                                 | [DOCUMENTED]                  |
| Rotation            | Manual — create a new key and delete the old one in Settings → API Keys             | [INFERRED — no API to rotate] |
| Rate limits per key | Per **account**, not per key — multiple keys share one account quota                | [DOCUMENTED]                  |
| Plan gate           | API requires **Expert plan or higher**; Forms API is **Enterprise-only**            | [DOCUMENTED]                  |

**Smoke test:**

```http
GET /me HTTP/1.1
Host: api.connecteam.com
Accept: application/json
X-API-KEY: {api_token}
```

### OAuth auth (sibling `connecteam-oauth` connector — for cross-consistency)

| Parameter   | Value                                                                                | Source       |
| ----------- | ------------------------------------------------------------------------------------ | ------------ |
| Grant type  | `client_credentials` (server-to-server; no user redirect/consent)                    | [DOCUMENTED] |
| Token URL   | `POST https://api.connecteam.com/oauth/v1/token` (HTTP Basic: clientId:clientSecret) | [DOCUMENTED] |
| Header sent | `Authorization: Bearer {access_token}` (24h lifetime, no refresh token)              | [DOCUMENTED] |
| Scopes      | `feature.permission`, e.g. `users.read`, `schedule.write`; immutable after creation  | [DOCUMENTED] |

> **Implication for this connector:** the API-key path is materially simpler — the relay just
> attaches `X-API-KEY` and forwards. There is no token-mint, cache, or refresh layer. The single
> error surface that differs in cause from OAuth is a bad/revoked key (401/403) vs a token-mint
> failure.

---

## Endpoint Catalog

> Endpoints are identical to `connecteam-oauth`. The **only** difference is the auth header
> (`X-API-KEY: {key}` here vs `Authorization: Bearer {token}` for OAuth). Examples below use `X-API-KEY`.
> Paths use **underscores** (`time_clock`, `form_submissions`), not hyphens.

### Identity

| Method | Path  | Purpose                     | Auth | Paginated | Idempotent |
| ------ | ----- | --------------------------- | ---- | --------- | ---------- |
| GET    | `/me` | Account/identity smoke test | Yes  | No        | Yes        |

> The only endpoint **without** a module prefix. Use it to confirm the key. [DOCUMENTED]

### Users

| Method | Path                       | Purpose                  | Auth | Paginated | Idempotent |
| ------ | -------------------------- | ------------------------ | ---- | --------- | ---------- |
| GET    | `/users/v1/users`          | List users (filters)     | Yes  | Yes       | Yes        |
| GET    | `/users/v1/users/{userId}` | Get single user          | Yes  | No        | Yes        |
| POST   | `/users/v1/users`          | Create users (batch ≤25) | Yes  | No        | No         |
| PUT    | `/users/v1/users`          | Update users (batch)     | Yes  | No        | Yes        |
| DELETE | `/users/v1/users/{userId}` | Delete a user            | Yes  | No        | Yes        |
| DELETE | `/users/v1/users`          | Archive users (bulk)     | Yes  | No        | Yes        |
| POST   | `/users/v1/admins`         | Promote user to admin    | Yes  | No        | No         |

> Batch create is capped at **25 users per request**. [DOCUMENTED] `GET /{userId}` and `PUT` are
> [INFERRED] from the reference pattern. IDs here are **integers**.

### Time Clock

| Method | Path                                              | Purpose                       | Auth | Paginated | Idempotent |
| ------ | ------------------------------------------------- | ----------------------------- | ---- | --------- | ---------- |
| GET    | `/time_clock/v1/time_clocks`                      | List time clocks              | Yes  | Yes       | Yes        |
| GET    | `/time_clock/v1/time_clocks/{id}/time_activities` | List activities (≤92-day win) | Yes  | Yes       | Yes        |
| POST   | `/time_clock/v1/time_clocks/{id}/time_activities` | Create time activities        | Yes  | No        | No         |
| PUT    | `/time_clock/v1/time_clocks/{id}/time_activities` | Update time activities        | Yes  | No        | Yes        |
| POST   | `/time_clock/v1/time_clocks/{id}/clock_in`        | Real-time clock-in            | Yes  | No        | No         |
| POST   | `/time_clock/v1/time_clocks/{id}/clock_out`       | Real-time clock-out           | Yes  | No        | No         |
| GET    | `/time_clock/v1/time_clocks/{id}/timesheet`       | Aggregated payroll summary    | Yes  | Yes       | Yes        |
| GET    | `/time_clock/v1/time_clocks/{id}/manual_breaks`   | Manual breaks                 | Yes  | Yes       | Yes        |

> **Time-activity queries are limited to a 92-day (3-month) window.** A wider `startDate`/`endDate`
> range is rejected. `startDate`/`endDate` are `YYYY-MM-DD` strings; activity `start`/`end`
> timestamps are Unix **seconds**. [DOCUMENTED] Archived time clocks ARE returned by the list
> endpoint (historical data is readable; new entries can't be created against an archived clock).
> Time-clock IDs are **integers**. [DOCUMENTED]

### Scheduler

| Method | Path                                                            | Purpose                   | Auth | Paginated | Idempotent |
| ------ | --------------------------------------------------------------- | ------------------------- | ---- | --------- | ---------- |
| GET    | `/scheduler/v1/schedulers`                                      | List schedulers           | Yes  | Yes       | Yes        |
| GET    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | List shifts (filters)     | Yes  | Yes       | Yes        |
| GET    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts/{shiftId}`         | Get single shift          | Yes  | No        | Yes        |
| POST   | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Create shifts (≤500)      | Yes  | No        | No         |
| PUT    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Update shifts (bulk)      | Yes  | No        | Yes        |
| DELETE | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`                   | Delete shifts (bulk ≤20)  | Yes  | No        | Yes        |
| GET    | `/scheduler/v1/schedulers/{sid}/shift_layers`                   | List shift layers         | Yes  | Yes       | Yes        |
| GET    | `/scheduler/v1/schedulers/{sid}/custom_fields`                  | Shift custom fields       | Yes  | Yes       | Yes        |
| GET    | `/scheduler/{v1\|v2}/schedulers/user_unavailability`            | User unavailabilities     | Yes  | Yes       | Yes        |
| POST   | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts_auto_assign`       | Start auto-assign (async) | Yes  | No        | No         |
| GET    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts_auto_assign/{rid}` | Poll auto-assign result   | Yes  | No        | Yes        |

> **Two API versions exist concurrently — V1 and V2.** V2 is the newer surface; default to **V2**
> for new work per the docs' migration guidance, but V1 endpoints remain available. `GET /shifts`
> **requires** `startTime` + `endTime` (Unix seconds); shifts that **overlap** the window are
> returned. Shift IDs are **24-char hex strings** (e.g. `6784dacb3c07733b0a849f49`), not integers.
> Auto-assign is the only async/polling pattern in the whole API. [DOCUMENTED]

### Jobs (resource)

| Method | Path                     | Purpose                | Auth | Paginated | Idempotent |
| ------ | ------------------------ | ---------------------- | ---- | --------- | ---------- |
| GET    | `/jobs/v1/jobs`          | List jobs / sub-jobs   | Yes  | Yes       | Yes        |
| GET    | `/jobs/v1/jobs/{jobId}`  | Get a job              | Yes  | No        | Yes        |
| POST   | `/jobs/v1/jobs`          | Create job             | Yes  | No        | No         |
| PUT    | `/jobs/v1/jobs/{jobId}`  | Update job             | Yes  | No        | Yes        |
| DELETE | `/jobs/v1/jobs/{jobId}`  | Delete job (soft)      | Yes  | No        | Yes        |
| GET    | `/jobs/v1/custom_fields` | Resource custom fields | Yes  | Yes       | Yes        |

> **Job IDs are UUID strings** (e.g. `9fdebf1f-0c69-4914-89d2-8f86c3e5f47d`), not integers. Jobs use
> `isDeleted` soft-delete with an `includeDeleted` filter; sub-jobs are modelled via `parentId`.
> [DOCUMENTED]

### Forms

| Method | Path                                             | Purpose                    | Auth | Paginated | Idempotent |
| ------ | ------------------------------------------------ | -------------------------- | ---- | --------- | ---------- |
| GET    | `/forms/v1/forms`                                | List forms                 | Yes  | Yes       | Yes        |
| GET    | `/forms/v1/forms/{formId}`                       | Get a form                 | Yes  | No        | Yes        |
| GET    | `/forms/v1/forms/{formId}/form_submissions`      | List submissions (filters) | Yes  | Yes       | Yes        |
| GET    | `/forms/v1/forms/{formId}/form_submissions/{id}` | Get single submission      | Yes  | No        | Yes        |
| PUT    | `/forms/v1/forms/{formId}/form_submissions/{id}` | Update manager fields only | Yes  | No        | Yes        |

> **Forms API is Enterprise-plan only.** Only **manager fields** (person / status / note / date) are
> writable on a submission; the answer entries are read-only. [DOCUMENTED] Dropdown-question options
> under `/forms/v1/forms/{formId}/questions/{questionId}` support full CRUD.

### Attachments, Webhooks, and other modules

| Method              | Path                                             | Purpose                       | Auth | Confidence   |
| ------------------- | ------------------------------------------------ | ----------------------------- | ---- | ------------ |
| POST                | `/attachments/v1/files/generate_upload_url`      | Pre-signed upload URL         | Yes  | [DOCUMENTED] |
| PUT                 | `/attachments/v1/files/complete_upload/{fileId}` | Finalise upload               | Yes  | [DOCUMENTED] |
| POST                | `/attachments/v1/files/download_url`             | Pre-signed download URL       | Yes  | [DOCUMENTED] |
| GET                 | `/settings/v1/webhooks`                          | List webhook subscriptions    | Yes  | [DOCUMENTED] |
| POST                | `/settings/v1/webhooks`                          | Create a webhook subscription | Yes  | [DOCUMENTED] |
| GET/POST/PUT/DELETE | `/tasks/v1/taskboards/{id}/tasks`                | Tasks + sub-tasks CRUD        | Yes  | [DOCUMENTED] |
| GET                 | `/time_off/v1/...`                               | Time-off policies/balances    | Yes  | [DOCUMENTED] |

### Full Endpoint Index

> Full list derived from `developer.connecteam.com/llms.txt` (~110 endpoints across 18 feature
> areas). All require `X-API-KEY` auth. offset/limit pagination applies to list endpoints. The most
> integration-relevant rows are below; the long tail (sales, onboarding, chat, publishers, assets,
> pay rates, company policies, smart groups, custom-field categories) exists in the same shape.

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

---

## Data Models

> Field names are from the reference overview pages; types are `[INFERRED]` where the JSON schema is
> hidden behind ReadMe's interactive "Try It" widget. **Forward-compatible schemas:** the docs warn
> new fields may be added to responses — parse leniently, don't fail on unknown fields. [DOCUMENTED]

### User (Employee) [DOCUMENTED — fields]

| Field          | Type              | Required | Writable | Description                              | Example              |
| -------------- | ----------------- | -------- | -------- | ---------------------------------------- | -------------------- |
| userId         | integer           | yes      | no       | Unique identifier                        | `7031021`            |
| firstName      | string            | yes      | yes      | Given name                               | `"Omer"`             |
| lastName       | string            | yes      | yes      | Family name                              | `"Vered"`            |
| phoneNumber    | string (E.164)    | yes      | yes      | Login identity (Connecteam is phone-led) | `"+9720548888888"`   |
| email          | string            | no       | yes      | Email address                            | `"user@example.com"` |
| userType       | enum              | yes      | no       | `owner` / `admin` / `manager` / `user`   | `"owner"`            |
| isArchived     | boolean           | yes      | no       | Archived state                           | `false`              |
| smartGroupsIds | array<integer>    | no       | yes      | Smart group memberships                  | `[2359154, 2359155]` |
| customFields   | array<object>     | no       | yes      | Tenant-defined custom fields             | see below            |
| createdAt      | integer (epoch s) | yes      | no       | Creation timestamp (Unix **seconds**)    | `1712573537`         |
| modifiedAt     | integer (epoch s) | yes      | no       | Last-modified timestamp                  | `1723640035`         |
| lastLogin      | integer (epoch s) | no       | no       | Last login                               | `1723640035`         |

**Custom field shape:** `{ "customFieldId": 6208755, "name": "Title", "type": "str", "value": "Solution Engineer" }`

**Relationships:** a User is the `assignedUserId` on Shifts, the `userId` on Time Activities, and the submitter of Form Submissions.

### Time Activity (Shift / Manual break / Time-off) [DOCUMENTED — fields]

| Field          | Type              | Required | Writable     | Description                              | Example          |
| -------------- | ----------------- | -------- | ------------ | ---------------------------------------- | ---------------- |
| id             | string            | yes      | no           | Activity / shift identifier              | `"shift-abc123"` |
| userId         | integer           | yes      | yes (create) | Employee the activity belongs to         | `9170357`        |
| start          | object            | yes      | yes          | `{ timestamp, timezone, locationData? }` | see below        |
| end            | object            | yes      | yes          | `{ timestamp, timezone, locationData? }` | see below        |
| jobId          | string (UUID)     | no       | yes          | Associated job                           | `"job-123"`      |
| employeeNote   | string            | no       | yes          | Employee note                            | `"Imported"`     |
| managerNote    | string            | no       | yes          | Manager note                             | `""`             |
| isAutoClockOut | boolean           | no       | no           | Was auto-clocked-out                     | `false`          |
| createdAt      | integer (epoch s) | yes      | no           | Creation timestamp                       | `1704110400`     |

**start/end object:** `{ "timestamp": 1704110400, "timezone": "America/New_York", "locationData": {...} }`

**Relationships:** belongs to a Time Clock (path param `timeClockId`) and references a User by `userId`. An activity with no closing `end` is "open" (clocked-in).

### Shift [DOCUMENTED — fields]

| Field           | Type              | Required | Writable | Description                    | Example                                  |
| --------------- | ----------------- | -------- | -------- | ------------------------------ | ---------------------------------------- |
| id              | string (hex)      | yes      | no       | Shift identifier (24-char hex) | `"6784dacb3c07733b0a849f49"`             |
| title           | string            | no       | yes      | Shift name                     | `"Morning Shift"`                        |
| assignedUserIds | array<integer>    | no       | yes      | Assigned employee IDs          | `[9170357]`                              |
| startTime       | integer (epoch s) | yes      | yes      | Shift start (Unix **seconds**) | `1736924400`                             |
| endTime         | integer (epoch s) | yes      | yes      | Shift end                      | `1736953200`                             |
| jobId           | string (UUID)     | no       | yes      | Associated job                 | `"d4ad7232-576f-2ff6-c57d-8240f1089b00"` |
| isPublished     | boolean           | yes      | yes      | Visible to employees           | `true`                                   |
| isOpenShift     | boolean           | yes      | yes      | Claimable / unassigned         | `false`                                  |
| color           | string (#RRGGBB)  | no       | yes      | Hex colour                     | `"#4B7AC5"`                              |

**Relationships:** belongs to a Scheduler (path `schedulerId`); `assignedUserIds` reference Users; `jobId` references a Job (UUID).

### Job (resource) [DOCUMENTED — fields]

| Field       | Type           | Required | Writable | Description                        | Example                                  |
| ----------- | -------------- | -------- | -------- | ---------------------------------- | ---------------------------------------- |
| jobId       | string (UUID)  | yes      | no       | Unique identifier                  | `"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d"` |
| title       | string         | yes      | yes      | Job name                           | `"Delivery Driver"`                      |
| code        | string         | no       | yes      | Job code                           | `"DD-001"`                               |
| color       | string         | no       | yes      | Hex colour                         | `"#3968BB"`                              |
| gps         | object         | no       | yes      | `{ address, longitude, latitude }` | see below                                |
| isDeleted   | boolean        | yes      | no       | Soft-deleted state                 | `false`                                  |
| assign      | object         | no       | yes      | `{ type, userIds[], groupIds[] }`  | `{"type":"both","userIds":[7031021]}`    |
| instanceIds | array<integer> | no       | yes      | Scheduler/time-clock IDs job is on | `[6833518]`                              |
| parentId    | string         | no       | yes      | Parent job (for sub-jobs)          | —                                        |

**gps object:** `{ "address": "123 Main St", "longitude": -73.93, "latitude": 40.71 }`

### Form Submission [DOCUMENTED — partial; full schema not in public example]

| Field            | Type              | Required | Writable | Description                                                |
| ---------------- | ----------------- | -------- | -------- | ---------------------------------------------------------- |
| formSubmissionId | string/integer    | -        | no       | Unique submission id                                       |
| formId           | integer           | -        | no       | Parent form                                                |
| userId           | integer           | -        | no       | Submitting user                                            |
| submissionTime   | integer (epoch s) | -        | no       | Submission timestamp                                       |
| answers          | array<object>     | -        | no       | Question/answer entries (read-only)                        |
| status           | enum              | -        | partial  | Manager field — writable via PUT (person/status/note/date) |

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

> **#1 integration bug:** Connecteam uses **Unix seconds**, not milliseconds and not ISO-8601, for
> all activity/shift times. **#2:** never coerce IDs — users/clocks/schedulers are **integers**, jobs
> are **UUID strings**, shifts are **24-char hex strings**. [DOCUMENTED]

---

## Query Parameters

Filtering is **whitelisted per endpoint** — there is no generic query language. Array filters use
repeated query params (`?userIds=1&userIds=2`); multiple distinct params are AND-combined; there is
no OR / nested filtering, no full-text search, no field selection, and no `include`-style relation
expansion. [DOCUMENTED params; AND-combination & no-search INFERRED]

### `GET /users/v1/users`

| Parameter      | Type            | Default  | Description                              |
| -------------- | --------------- | -------- | ---------------------------------------- |
| limit          | integer (1–500) | 10       | Page size                                |
| offset         | integer (≥0)    | 0        | Start position                           |
| sort           | string          | —        | Sort field (user creation time)          |
| order          | enum            | `asc`    | `asc` / `desc`                           |
| userIds        | array<int>      | —        | Filter by specific user ids              |
| userStatus     | enum            | `active` | `active` / `archived` (likely `all`)     |
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
| order          | enum          | `asc`   | `asc` / `desc`            |
| limit          | integer       | 10      | Page size (max 500)       |
| offset         | integer       | 0       | Start position            |

### `GET /time_clock/v1/time_clocks/{id}/time_activities`

| Parameter     | Type          | Default | Description                                |
| ------------- | ------------- | ------- | ------------------------------------------ |
| startDate     | `YYYY-MM-DD`  | —       | **Required.** Window start                 |
| endDate       | `YYYY-MM-DD`  | —       | **Required.** Window end (range ≤ 92 days) |
| userIds       | array<int>    | —       | Filter by employee                         |
| jobIds        | array<string> | —       | Filter by job UUID                         |
| activityTypes | array<enum>   | —       | `shift` / `manual_break` / `time_off`      |

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

---

## Pagination

- **Type:** offset / limit [DOCUMENTED]
- **Default page size:** 10 [DOCUMENTED]
- **Max page size:** 500 (documented on users + jobs; assume 500 elsewhere). [DOCUMENTED / INFERRED]
- **Total count:** **Not** returned — no `total`/`hasMore` field. The `paging` object only echoes an `offset`. Use the "fewer-than-limit" heuristic. [DOCUMENTED]

**Parameters:**

| Parameter | Type    | Default | Description              |
| --------- | ------- | ------- | ------------------------ |
| limit     | integer | 10      | Items per page (max 500) |
| offset    | integer | 0       | Starting position        |

**Response structure (success envelope is `{ requestId, data, paging? }`):**

```json
{
  "requestId": "req_8f3c1a",
  "data": {
    "users": [
      /* ... */
    ]
  },
  "paging": { "offset": 0 }
}
```

> ⚠️ **`paging` location is inconsistent across the API.** Users put it at the **top level**
> (`paging.offset`); jobs/shifts nest it under **`data.paging.offset`**. Parsers must check both
> locations. [DOCUMENTED]

**Last page detection:** the returned array has **fewer items than `limit`**. There is no explicit terminator field. [DOCUMENTED]

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items  (full page → continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items  (full page → continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items  (< limit → LAST PAGE)
```

**Bulk caps:** users create/update ≤ **25**; shift create ≤ **500**; bulk shift delete ≤ **20**. Per-item partial-failure reporting is [UNKNOWN — discovery needed].

---

## Rate Limits

Limits are **per Connecteam account**, shared across **every** API client (this connector plus any
other integration, plus the OAuth connector) — **not** per key. On SBP's 5/min you throttle almost
immediately.

| Scope (per account) | Per Minute   | Per Day | Source       |
| ------------------- | ------------ | ------- | ------------ |
| SBP plan            | 5 requests   | 100     | [DOCUMENTED] |
| Expert plan         | 100 requests | 10,000  | [DOCUMENTED] |
| Enterprise plan     | 200 requests | 20,000  | [DOCUMENTED] |

**Headers (six, all returned):**

| Header                         | Meaning                         | Example      |
| ------------------------------ | ------------------------------- | ------------ |
| `x-ratelimit-minute-limit`     | Minute quota                    | `100`        |
| `x-ratelimit-minute-remaining` | Remaining this minute           | `87`         |
| `x-ratelimit-minute-reset`     | Reset (UTC epoch **seconds**)   | `1745625660` |
| `x-ratelimit-day-limit`        | Daily quota                     | `10000`      |
| `x-ratelimit-day-remaining`    | Remaining today                 | `9213`       |
| `x-ratelimit-day-reset`        | Daily reset (UTC epoch seconds) | `1745712000` |

**When exceeded:** `HTTP 429 Too Many Requests`, body uses the `detail` field (e.g.
`{ "detail": "Too many requests" }`). [DOCUMENTED] **No `Retry-After` header** — compute the wait
from `x-ratelimit-minute-reset`. A community report notes the API sometimes returns **200 with
`x-ratelimit-*-remaining: 0` instead of 429** — trust the remaining headers. [DOCUMENTED]

**Recommended strategy:** exponential backoff + honour `*-reset` timestamps; proactively pause when `*-remaining` is low; cache slow-changing list reads aggressively. [DOCUMENTED]

---

## Error Handling

**Standard error format** — the success envelope is `{ requestId, data, paging? }`; the documented
error shape uses a **`detail`** field. A comprehensive per-status error table is **not published**
(the docs defer to the live API Reference), so 401/403/422 bodies are [INFERRED] from convention.

```json
{ "detail": "Too many requests" }
```

**Status codes:**

| Status | Meaning          | Retryable | Recovery                                                            |
| ------ | ---------------- | --------- | ------------------------------------------------------------------- |
| 200    | Success          | -         | -                                                                   |
| 400    | Bad request      | No        | Fix request parameters per `detail`                                 |
| 401    | Unauthorized     | No        | Invalid/revoked `X-API-KEY` — verify the key; not retryable         |
| 403    | Forbidden        | No        | Plan-gated (need Expert+/Enterprise) or feature not on plan (Forms) |
| 404    | Not found        | No        | Verify the id (int vs UUID vs hex) and the path module/version      |
| 422    | Validation error | No        | Fix the offending field(s) per `detail`                             |
| 429    | Rate limited     | Yes       | Back off using `x-ratelimit-minute-reset`; no `Retry-After`         |
| 5xx    | Server error     | Yes       | Retry with exponential backoff + jitter                             |

> **Auth note:** a bad/revoked `X-API-KEY` returns 401/403 (exact body unconfirmed). This is the
> **one** error surface whose cause differs from the OAuth connector (which would instead fail at the
> token-mint step). [DOCUMENTED]

---

## Webhooks / Events

**Registration:** `POST /settings/v1/webhooks` (also creatable in the UI Integration Center). The
webhook is managed by the same API and fires regardless of which auth method created it. [DOCUMENTED]

**Subscription body:**

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

- `objectId` is required for all feature types **except `users`**. [DOCUMENTED]
- `secretKey` is optional, for signature verification. [DOCUMENTED]

**Event catalog (by feature type):** [DOCUMENTED]

| featureType       | Event types                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_promoted` |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`             |
| `time_activity`   | `clock_in`, `clock_out`, `admin_add`, `admin_edit`, `admin_approved_add_request` |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created` |
| `tasks`           | `task_published`, `task_completed`                                               |

**Verification:** a `secretKey` supplied at registration is used "for webhook signature verification"
— the exact signature header/algorithm is **not documented**. [DOCUMENTED — mechanism; UNKNOWN — details]
**Retry policy:** fixed `retryLimit` of **3** attempts. [DOCUMENTED] Ordering/dedup guarantees [UNKNOWN].
**Payload body shape:** **[UNKNOWN — per-feature `/docs/*-webhook` pages exist; exact payloads not captured]**.

**Polling fallback:** any list endpoint with a `modifiedAt` epoch-second filter (e.g.
`GET /users/v1/users?modifiedAt=…`); poll every few minutes, respecting the per-account minute cap. [DOCUMENTED]

---

## Known Limitations

1. **No live-tested examples** — response envelopes, error bodies (401/403/422), and webhook payloads are [DOCUMENTED-shape]/[INFERRED]/[UNKNOWN]. The CRITICAL GATE (live `GET /me`) is not passed.
2. **Plan gating** — API requires **Expert plan or higher**; **Forms API is Enterprise-only**; SBP is throttled to 5 req/min. [DOCUMENTED]
3. **Per-account rate limits shared across every key/client** — easy to throttle on lower plans. [DOCUMENTED]
4. **92-day cap** on time-activity queries — chunk wider ranges into ≤ 90-day windows. [DOCUMENTED]
5. **No total count** — page until the array is shorter than `limit`. [DOCUMENTED]
6. **`paging` location varies** — top-level for users, nested under `data` for jobs/shifts. [DOCUMENTED]
7. **No `Retry-After` on 429** — compute the wait from `x-ratelimit-minute-reset`; the API may also return 200 with `*-remaining: 0`. [DOCUMENTED]
8. **Mixed ID types** — integers (users/clocks/schedulers), UUIDs (jobs), hex strings (shifts); never coerce. [DOCUMENTED]
9. **Module-versioned, underscore paths** — no global `/v1`; `/users/v1/...`, `/time_clock/v1/...`, `/scheduler/v2/...`. [DOCUMENTED]
10. **No full-text search, no field selection, no relation expansion, no idempotency keys.** [INFERRED]
11. **Scheduler V1-vs-V2 exact differences** (response shapes) need the `/docs/scheduler-shifts-vision-*` pages. [INFERRED — discovery needed]

---

## SDKs & Tooling

| SDK / Tool      | Language | Repository / URL                                                               | Quality | Notes                                                         |
| --------------- | -------- | ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------- |
| (none official) | —        | —                                                                              | —       | Docs show raw `requests`/`fetch`/curl only [DOCUMENTED]       |
| Official MCP    | —        | [developer.connecteam.com/docs/mcp](https://developer.connecteam.com/docs/mcp) | n/a     | MCP server for AI agents — informative reference [DOCUMENTED] |
| Pipedream app   | —        | [pipedream.com/apps/connecteam](https://pipedream.com/apps/connecteam)         | Fair    | Pre-built actions/triggers [DOCUMENTED]                       |

**Postman collection:** None official located. [UNKNOWN]
**OpenAPI spec:** Not located as a single download; `developer.connecteam.com/llms.txt` is the closest machine-readable index. [DOCUMENTED]

---

## Integration Path Assessment

**Recommended path:** **Direct API via `connect_request`** (not a Files connector).

**Justification:** Connecteam exposes **records** (users, time activities, shifts, form submissions,
jobs), not a browsable file tree. There is no `list_files`/`download_file` semantic to map onto (the
few attachment endpoints are peripheral). The workspace agent calls the REST endpoints through Numa's
`connect_request` proxy, which injects the stored `api_token` as the `X-API-KEY` header. This mirrors
how spec-driven API connectors (e.g. simPRO, Fergus' Direct-API portion) are wired — not the
file-browser providers (Drive/Gmail/OneDrive/Dropbox). Because auth is a static header (no token
exchange, no refresh, no expiry), the API-key path is the simplest of the two Connecteam connectors
to operate.

**Connector compatibility (Files-connector methods — for completeness; not used here):**

| Connector Method  | API Endpoint | Feasibility                                |
| ----------------- | ------------ | ------------------------------------------ |
| list_files        | —            | none — Connecteam has no file/folder tree  |
| download_file     | —            | none                                       |
| search_files      | —            | none — value filters on records, not files |
| get_file_metadata | —            | none                                       |

---

_Researched on 2026-05-29. Sources: Connecteam developer portal (developer.connecteam.com —
`llms.txt`, reference, authentication, pagination, rate-limiting, OAuth 2.0, read-users, get-jobs,
time-clock-time-activities, scheduler-get-shifts, setting-up-webhook-via-api pages), help-centre API
collection, developer discuss forum, and the Numa connector registry
(`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`). No live API call was made — the
CRITICAL GATE is not passed; treat envelopes/error bodies/webhook payloads as [DOCUMENTED-shape]/[INFERRED]/[UNKNOWN]._
