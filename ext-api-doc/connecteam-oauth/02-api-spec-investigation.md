---
api_name: 'Connecteam API (OAuth)'
api_slug: 'connecteam-oauth'
base_url: 'https://api.connecteam.com'
version: 'v1 (per-module path versioning)'
spec_format: 'none publicly located (ReadMe-hosted; OpenAPI likely backs the portal but URL not found)'
spec_url: ''
docs_url: 'https://developer.connecteam.com'
date_researched: '2026-05-29'
---

# Connecteam (OAuth) -- API Specification & Investigation

> Clean developer reference for the Connecteam REST API. This document is the condensed
> output of the investigation questionnaire -- everything a developer needs to integrate
> with this API, in one place.
>
> **Shared-API note:** This is the **same REST API** as the `connecteam-api` (API-key) connector.
> The base URL, endpoint catalog, data models, query/filter, pagination, rate-limit, error, and
> webhook behaviour are **identical** between the two connectors — **only the Authentication
> section differs** (OAuth bearer token vs `X-API-KEY` header). Keep this file consistent with
> `connecteam-api/02-api-spec-investigation.md`; the only intended divergence is "Authentication".
>
> Confidence markers per the investigation: `[CONFIRMED]` (verified against a live call),
> `[DOCUMENTED]` (in official vendor docs), `[INFERRED]`, `[UNKNOWN]`. **No live OAuth call was
> possible**, so almost nothing here is `[CONFIRMED]`.

---

## Overview

- **Vendor:** Connecteam Ltd. [CONFIRMED]
- **API version:** `v1`, versioned **per module** in the path — `/users/v1`, `/time-clock/v1`, `/scheduler/v1`, `/forms/v1`, `/settings/v1`. There is **no** global `/v1` prefix. [DOCUMENTED]
- **Base URL:** `https://api.connecteam.com` (global) [DOCUMENTED]
- **AU data-residency URL:** `https://api-au.connecteam.com` — AU-resident tenants MUST use this host. [DOCUMENTED]
- **Sandbox URL:** Not available — testing uses a live Enterprise account. [UNKNOWN — no sandbox documented]
- **API type:** REST [CONFIRMED]
- **Data format:** JSON [CONFIRMED]
- **Documentation:** [developer.connecteam.com](https://developer.connecteam.com) (ReadMe-hosted portal) [CONFIRMED]
- **API reference:** [developer.connecteam.com/reference](https://developer.connecteam.com/reference) (per-operation pages, slug pattern `{verb}_{operationId}`) [CONFIRMED]
- **Auth guides:** [API key](https://developer.connecteam.com/docs/authentication-1) · [OAuth 2.0 (Beta)](https://developer.connecteam.com/docs/oauth-20) [CONFIRMED — both fetched]
- **Changelog:** [developer.connecteam.com/changelog](https://developer.connecteam.com/changelog) [CONFIRMED]
- **Help-centre API articles:** [help.connecteam.com/en/collections/11374088](https://help.connecteam.com/en/collections/11374088-api-s-integrations) [CONFIRMED]
- **Developer Q&A:** [developer.connecteam.com/discuss](https://developer.connecteam.com/discuss) [CONFIRMED]
- **Public API roadmap board:** [connecteam.canny.io/publicapi](https://connecteam.canny.io/publicapi) [CONFIRMED]
- **OpenAPI spec:** Not located. ReadMe portals are usually OpenAPI-backed, but no public `openapi.json` URL was found. [INFERRED — discovery needed]
- **Status page:** None found. [UNKNOWN]

**Summary:** Connecteam is a deskless-workforce management platform (time clock, employee scheduling, digital forms, task management, HR). The REST API exposes Users (employees), Time Clock activities & timesheets, Scheduler shifts, Forms & submissions, Jobs/sub-jobs, Attachments, and Webhook subscriptions. **The public API is Enterprise-plan-only** — on lower plans the API/Integration tabs are not exposed. [DOCUMENTED]

---

## Authentication

> ⚠️ **This is the only material divergence from the `connecteam-api` connector — and it contains an unresolved conflict between the Numa connector registry and Connecteam's official docs. Reconcile before building.** Full setup and reauthorization detail lives in `04-connection-and-reauth.md`.

### Method: OAuth 2.0 (Bearer token)

Numa's registry classifies this connector as `authType: 'oauth2'`. All calls flow through Numa's `connect_request` proxy, which injects the bearer token from the user's vault — the workspace agent never performs the token exchange itself.

**Header format (every request):**

```
Authorization: Bearer {access_token}
Accept: application/json
Content-Type: application/json     ← on POST/PUT bodies only
```

### ⚠️ Registry vs official OAuth docs — the conflict

| Aspect            | Numa registry (`connecteam-oauth`)                     | Official Connecteam OAuth 2.0 (Beta) docs                         |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Grant type        | Implies `authorization_code` (it carries an `authUrl`) | **`client_credentials` only** (server-to-server, no user consent) |
| Authorization URL | `https://app.connecteam.com/oauth/authorize`           | **None** — a client_credentials flow has no consent endpoint      |
| Token URL         | `https://app.connecteam.com/oauth/token`               | **`https://api.connecteam.com/oauth/v1/token`**                   |
| Client auth       | (standard code exchange)                               | HTTP **Basic** (Client ID = username, Client Secret = password)   |
| App registration  | "Developer Portal → Create an integration"             | "Your Name → Integration Center → OAuth 2.0 → Create app"         |
| Scopes            | `forms.read attachments.write`                         | `feature.permission`, e.g. `users.read`, `schedule.write`         |

- Registry `authUrl`/`tokenUrl` (`app.connecteam.com/oauth/*`): **[UNKNOWN — unverified]**. Could not be confirmed against any official page; treat as placeholders until verified with Connecteam.
- Official token endpoint `https://api.connecteam.com/oauth/v1/token`: **[DOCUMENTED]**.

**Implication:** if the official docs are accurate, this is a machine-to-machine `client_credentials` integration with **no redirect/consent step**, which does not fit Numa's redirect-based OAuth wizard cleanly and overlaps heavily with the API-key (`connecteam-api`) connector. This must be resolved before the connector is built. See `04-connection-and-reauth.md` §"Open conflict".

### OAuth 2.0 configuration (as officially documented — `client_credentials`)

| Parameter             | Value                                                                                   | Source       |
| --------------------- | --------------------------------------------------------------------------------------- | ------------ |
| Grant type            | `client_credentials`                                                                    | [DOCUMENTED] |
| Authorization URL     | N/A for client_credentials (registry value `app.connecteam.com/oauth/authorize`)        | [UNKNOWN]    |
| Token URL             | `https://api.connecteam.com/oauth/v1/token`                                             | [DOCUMENTED] |
| Client authentication | HTTP Basic — `Authorization: Basic base64(clientId:clientSecret)`                       | [DOCUMENTED] |
| Token request body    | `grant_type=client_credentials` (`application/x-www-form-urlencoded`); optional `scope` | [DOCUMENTED] |
| Access token lifetime | **86400 s (24 h)** — response field `expires_in: 86400`                                 | [DOCUMENTED] |
| Refresh mechanism     | **None** — re-request a token from the token endpoint when it expires                   | [DOCUMENTED] |
| Revocation URL        | Not documented                                                                          | [UNKNOWN]    |
| PKCE required         | N/A for client_credentials                                                              | [UNKNOWN]    |
| Client Secret         | Shown **once** at app creation — capture immediately                                    | [DOCUMENTED] |
| Scope mutability      | **Immutable after app creation** — to change scopes you must create a new app           | [DOCUMENTED] |

**Token response:**

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "users.read forms.read"
}
```

### Required scopes

Scope format is `feature.permission`. The Numa registry currently requests `forms.read attachments.write`. For read-only chat use, request the read scopes for every module you intend to query.

| Scope               | Purpose                                    | Required for Numa?                                                          |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `users.read`        | Read users / employees                     | Recommended (read-only chat) [DOCUMENTED]                                   |
| `schedule.read`     | Read schedulers & shifts                   | Recommended [DOCUMENTED]                                                    |
| `timeclock.read` \* | Read time clocks / activities / timesheets | Recommended (\* exact slug unverified) [INFERRED]                           |
| `forms.read`        | Read forms & submissions                   | Yes — in registry [DOCUMENTED]                                              |
| `attachments.write` | Upload attachments                         | In registry; a **write** scope — reconsider for read-only chat [DOCUMENTED] |
| `users.write`       | Create / update users                      | Only if mutations enabled [DOCUMENTED]                                      |
| `schedule.write`    | Create / update shifts                     | Only if mutations enabled [DOCUMENTED]                                      |
| `schedule.delete`   | Delete shifts                              | Avoid unless explicitly needed [DOCUMENTED]                                 |

> **Scope gotcha:** scopes are **frozen at app-creation time**. Pick the full read set (plus any writes you truly need) up front, or you will have to register a new app to add one.

### API-key auth (sibling `connecteam-api` connector — for cross-consistency)

| Parameter     | Value                                                                  | Source       |
| ------------- | ---------------------------------------------------------------------- | ------------ |
| Header        | `X-API-KEY: {key}`                                                     | [DOCUMENTED] |
| How to obtain | Settings → API Keys → "Add API key" (owner / Enterprise)               | [DOCUMENTED] |
| Smoke test    | `curl --url 'https://api.connecteam.com/me' --header 'X-API-KEY: ...'` | [DOCUMENTED] |

---

## Endpoint Catalog

### Identity

| Method | Path  | Purpose                     | Auth | Paginated | Idempotent |
| ------ | ----- | --------------------------- | ---- | --------- | ---------- |
| GET    | `/me` | Account/identity smoke test | Yes  | No        | Yes        |

> The only endpoint **without** a module prefix. Use it to confirm credentials. [DOCUMENTED]

### Users

| Method | Path                       | Purpose                  | Auth | Paginated | Idempotent |
| ------ | -------------------------- | ------------------------ | ---- | --------- | ---------- |
| GET    | `/users/v1/users`          | List users (filters)     | Yes  | Yes       | Yes        |
| GET    | `/users/v1/users/{userId}` | Get single user          | Yes  | No        | Yes        |
| POST   | `/users/v1/users`          | Create users (batch ≤25) | Yes  | No        | No         |
| PUT    | `/users/v1/users`          | Update users (batch)     | Yes  | No        | Yes        |

> Batch actions are capped at **25 users per request**. [DOCUMENTED] `GET /{userId}` and `PUT` are [INFERRED] from the reference pattern.

### Time Clock

| Method | Path                                              | Purpose                       | Auth | Paginated | Idempotent |
| ------ | ------------------------------------------------- | ----------------------------- | ---- | --------- | ---------- |
| GET    | `/time-clock/v1/time-clocks`                      | List time clocks              | Yes  | Yes       | Yes        |
| GET    | `/time-clock/v1/time-clocks/{id}/time-activities` | List activities (≤92-day win) | Yes  | Yes       | Yes        |
| POST   | `/time-clock/v1/time-clocks/{id}/time-activities` | Create time activities        | Yes  | No        | No         |
| PUT    | `/time-clock/v1/time-clocks/{id}/time-activities` | Update time activities        | Yes  | No        | Yes        |
| POST   | `/time-clock/v1/time-clocks/{id}/clock-in`        | Real-time clock-in            | Yes  | No        | No         |
| POST   | `/time-clock/v1/time-clocks/{id}/clock-out`       | Real-time clock-out           | Yes  | No        | No         |
| GET    | `/time-clock/v1/time-clocks/{id}/timesheet`       | Aggregated payroll summary    | Yes  | Yes       | Yes        |

> **Time-activity queries are limited to a 92-day (3-month) window.** A wider `start`/`end` range is rejected. [DOCUMENTED]

### Scheduler

| Method | Path                                                            | Purpose                   | Auth | Paginated | Idempotent |
| ------ | --------------------------------------------------------------- | ------------------------- | ---- | --------- | ---------- |
| GET    | `/scheduler/v1/schedulers`                                      | List schedulers           | Yes  | Yes       | Yes        |
| GET    | `/scheduler/v1/schedulers/{sid}/shifts`                         | List shifts (filters)     | Yes  | Yes       | Yes        |
| GET    | `/scheduler/v1/schedulers/{sid}/shifts/{shiftId}`               | Get single shift          | Yes  | No        | Yes        |
| POST   | `/scheduler/v1/schedulers/{sid}/shifts`                         | Create shifts (≤500)      | Yes  | No        | No         |
| PUT    | `/scheduler/v1/schedulers/{sid}/shifts`                         | Update shifts (bulk)      | Yes  | No        | Yes        |
| DELETE | `/scheduler/v1/schedulers/{sid}/shifts`                         | Delete shifts (bulk ≤20)  | Yes  | No        | Yes        |
| DELETE | `/scheduler/v1/schedulers/{sid}/shifts/{shiftId}`               | Delete single shift       | Yes  | No        | Yes        |
| GET    | `/scheduler/v1/schedulers/{sid}/shift-layers`                   | List shift layers         | Yes  | Yes       | Yes        |
| GET    | `/scheduler/v1/schedulers/{sid}/shift-layers/{layerId}/values`  | Layer values              | Yes  | Yes       | Yes        |
| GET    | `/scheduler/v1/schedulers/user-unavailability`                  | User unavailabilities     | Yes  | Yes       | Yes        |
| POST   | `/scheduler/v1/schedulers/{sid}/unavailability`                 | Add unavailability        | Yes  | No        | No         |
| DELETE | `/scheduler/v1/schedulers/{sid}/unavailability/{uid}`           | Remove unavailability     | Yes  | No        | Yes        |
| POST   | `/scheduler/v1/schedulers/{sid}/shifts/auto-assign`             | Start auto-assign (async) | Yes  | No        | No         |
| GET    | `/scheduler/v1/schedulers/{sid}/shifts/auto-assign/{requestId}` | Poll auto-assign result   | Yes  | No        | Yes        |

> **Unsupported scheduler features:** data layers, shift tasks, repeating shifts, and group shifts are explicitly **not** supported via the API. [DOCUMENTED] Auto-assign is the only async/polling pattern in the whole API. [DOCUMENTED]

### Forms

| Method | Path                                             | Purpose                    | Auth | Paginated | Idempotent |
| ------ | ------------------------------------------------ | -------------------------- | ---- | --------- | ---------- |
| GET    | `/forms/v1/forms`                                | List forms                 | Yes  | Yes       | Yes        |
| GET    | `/forms/v1/forms/{formId}`                       | Get a form                 | Yes  | No        | Yes        |
| GET    | `/forms/v1/forms/{formId}/form-submissions`      | List submissions (filters) | Yes  | Yes       | Yes        |
| GET    | `/forms/v1/forms/{formId}/form-submissions/{id}` | Get single submission      | Yes  | No        | Yes        |
| PUT    | `/forms/v1/forms/{formId}/form-submissions/{id}` | Update manager fields only | Yes  | No        | Yes        |

> Only **manager fields** (person / status / note / date) are writable on a submission; the answer entries are read-only. [DOCUMENTED] `GET`/`PUT` single-submission paths are [INFERRED] from the reference pattern.

### Jobs, Attachments, Webhooks

| Method | Path                        | Purpose                       | Auth | Paginated | Idempotent | Confidence                                          |
| ------ | --------------------------- | ----------------------------- | ---- | --------- | ---------- | --------------------------------------------------- |
| GET    | `/jobs/v1/jobs` (+sub-jobs) | List jobs / sub-jobs          | Yes  | Yes       | Yes        | [INFERRED — module exists; exact paths not fetched] |
| POST   | `/attachments/v1/...`       | Upload an attachment          | Yes  | No        | No         | [INFERRED — `attachments.write` scope exists]       |
| POST   | `/settings/v1/webhooks`     | Create a webhook subscription | Yes  | No        | No         | [DOCUMENTED]                                        |

### Full Endpoint Index

| #   | Method | Path                                                       | Purpose                | Confidence   |
| --- | ------ | ---------------------------------------------------------- | ---------------------- | ------------ |
| 1   | GET    | `/me`                                                      | Identity smoke test    | [DOCUMENTED] |
| 2   | GET    | `/users/v1/users`                                          | List users             | [DOCUMENTED] |
| 3   | POST   | `/users/v1/users`                                          | Create users (≤25)     | [DOCUMENTED] |
| 4   | GET    | `/users/v1/users/{userId}`                                 | Get user               | [INFERRED]   |
| 5   | PUT    | `/users/v1/users`                                          | Update users           | [INFERRED]   |
| 6   | GET    | `/time-clock/v1/time-clocks`                               | List time clocks       | [DOCUMENTED] |
| 7   | GET    | `/time-clock/v1/time-clocks/{id}/time-activities`          | List activities (≤92d) | [DOCUMENTED] |
| 8   | POST   | `/time-clock/v1/time-clocks/{id}/time-activities`          | Create activities      | [DOCUMENTED] |
| 9   | PUT    | `/time-clock/v1/time-clocks/{id}/time-activities`          | Update activities      | [DOCUMENTED] |
| 10  | POST   | `/time-clock/v1/time-clocks/{id}/clock-in`                 | Clock in               | [DOCUMENTED] |
| 11  | POST   | `/time-clock/v1/time-clocks/{id}/clock-out`                | Clock out              | [DOCUMENTED] |
| 12  | GET    | `/time-clock/v1/time-clocks/{id}/timesheet`                | Timesheet summary      | [DOCUMENTED] |
| 13  | GET    | `/scheduler/v1/schedulers`                                 | List schedulers        | [DOCUMENTED] |
| 14  | GET    | `/scheduler/v1/schedulers/{sid}/shifts`                    | List shifts            | [DOCUMENTED] |
| 15  | GET    | `/scheduler/v1/schedulers/{sid}/shifts/{shiftId}`          | Get shift              | [DOCUMENTED] |
| 16  | POST   | `/scheduler/v1/schedulers/{sid}/shifts`                    | Create shifts (≤500)   | [DOCUMENTED] |
| 17  | PUT    | `/scheduler/v1/schedulers/{sid}/shifts`                    | Update shifts          | [DOCUMENTED] |
| 18  | DELETE | `/scheduler/v1/schedulers/{sid}/shifts`                    | Delete shifts (≤20)    | [DOCUMENTED] |
| 19  | DELETE | `/scheduler/v1/schedulers/{sid}/shifts/{shiftId}`          | Delete single shift    | [DOCUMENTED] |
| 20  | GET    | `/scheduler/v1/schedulers/{sid}/shift-layers`              | List shift layers      | [DOCUMENTED] |
| 21  | GET    | `/scheduler/v1/schedulers/{sid}/shift-layers/{lid}/values` | Layer values           | [DOCUMENTED] |
| 22  | GET    | `/scheduler/v1/schedulers/user-unavailability`             | User unavailabilities  | [DOCUMENTED] |
| 23  | POST   | `/scheduler/v1/schedulers/{sid}/unavailability`            | Add unavailability     | [DOCUMENTED] |
| 24  | DELETE | `/scheduler/v1/schedulers/{sid}/unavailability/{uid}`      | Remove unavailability  | [DOCUMENTED] |
| 25  | POST   | `/scheduler/v1/schedulers/{sid}/shifts/auto-assign`        | Start auto-assign      | [DOCUMENTED] |
| 26  | GET    | `/scheduler/v1/schedulers/{sid}/shifts/auto-assign/{rid}`  | Poll auto-assign       | [DOCUMENTED] |
| 27  | GET    | `/forms/v1/forms`                                          | List forms             | [DOCUMENTED] |
| 28  | GET    | `/forms/v1/forms/{formId}`                                 | Get form               | [DOCUMENTED] |
| 29  | GET    | `/forms/v1/forms/{formId}/form-submissions`                | List submissions       | [DOCUMENTED] |
| 30  | PUT    | `/forms/v1/forms/{formId}/form-submissions/{id}`           | Update manager fields  | [INFERRED]   |
| 31  | GET    | `/jobs/v1/jobs` (+ sub-jobs)                               | Jobs / sub-jobs        | [INFERRED]   |
| 32  | POST   | `/attachments/v1/...`                                      | Upload attachment      | [INFERRED]   |
| 33  | POST   | `/settings/v1/webhooks`                                    | Create webhook         | [DOCUMENTED] |

---

## Data Models

> Field names are from the reference overview pages; types are `[INFERRED]` where the JSON schema is hidden behind ReadMe's interactive "Try It" widget.

### User (Employee) [DOCUMENTED — fields; types INFERRED]

| Field        | Type              | Required | Writable | Description                              | Example                  |
| ------------ | ----------------- | -------- | -------- | ---------------------------------------- | ------------------------ |
| userId       | integer           | -        | no       | Unique user identifier                   | `4815162`                |
| firstName    | string            | yes      | yes      | Given name                               | `"Jane"`                 |
| lastName     | string            | yes      | yes      | Family name                              | `"Doe"`                  |
| phoneNumber  | string (E.164)    | yes      | yes      | Login identity (Connecteam is phone-led) | `"+14155550101"`         |
| email        | string            | no       | yes      | Email address                            | `"jane@acme.com"`        |
| userType     | enum              | no       | yes      | `user` / `manager` / `admin`             | `"user"`                 |
| userStatus   | enum              | no       | no       | `active` / `archived`                    | `"active"`               |
| customFields | array<object>     | no       | yes      | Tenant-defined custom fields             | `[{"id":1,"value":"…"}]` |
| createdAt    | integer (epoch s) | -        | no       | Creation timestamp                       | `1716950400`             |
| modifiedAt   | integer (epoch s) | -        | no       | Last-modified timestamp                  | `1716950400`             |

**Relationships:** a User is the `assignee` of Shifts, the `userId` on Time Activities, and the submitter of Form Submissions.

### Time Activity (Shift / Break / Time-off) [DOCUMENTED — fields]

| Field       | Type              | Required | Writable | Description                        | Example      |
| ----------- | ----------------- | -------- | -------- | ---------------------------------- | ------------ |
| timeClockId | integer           | yes      | no       | Parent time-clock (path param)     | `12345`      |
| userId      | integer           | yes      | yes      | Employee the activity belongs to   | `4815162`    |
| start       | integer (epoch s) | yes      | yes      | Activity start (Unix **seconds**)  | `1716969600` |
| end         | integer (epoch s) | no       | yes      | Activity end; absent if still open | `1716998400` |
| type        | enum              | yes      | yes      | `shift` / `break` / `timeoff`      | `"shift"`    |

**Relationships:** belongs to a Time Clock (path) and references a User by `userId`. An activity with no `end` is "open" (clocked-in).

### Shift [DOCUMENTED — fields; exact slugs INFERRED]

| Field        | Type              | Required | Writable | Description                             | Example       |
| ------------ | ----------------- | -------- | -------- | --------------------------------------- | ------------- |
| shiftId      | integer/string    | -        | no       | Unique shift id                         | `987654`      |
| schedulerId  | integer           | yes      | no       | Parent scheduler (path param)           | `321`         |
| type         | enum              | no       | yes      | `regular` / `open` / `draft` / `group`  | `"regular"`   |
| assignees    | array<integer>    | no       | yes      | userIds assigned to the shift           | `[4815162]`   |
| startTime    | integer (epoch s) | yes      | yes      | Shift start                             | `1716969600`  |
| endTime      | integer (epoch s) | yes      | yes      | Shift end                               | `1716998400`  |
| status       | enum              | no       | yes      | `published` / `draft`                   | `"published"` |
| shiftLayers  | array<object>     | no       | yes      | Layer values (jobs / locations / notes) | `[…]`         |
| customFields | array<object>     | no       | yes      | Tenant-defined custom fields            | `[…]`         |

**Relationships:** belongs to a Scheduler (path); `assignees` reference Users; `shiftLayers` can reference Jobs.

### Form Submission [INFERRED — response schema not exposed]

| Field         | Type              | Required | Writable | Description                                                     |
| ------------- | ----------------- | -------- | -------- | --------------------------------------------------------------- |
| submissionId  | integer/string    | -        | no       | Unique submission id                                            |
| formId        | integer           | -        | no       | Parent form                                                     |
| userId        | integer           | -        | no       | Submitting user                                                 |
| submittedAt   | integer (epoch s) | -        | no       | Submission timestamp                                            |
| entries       | array<object>     | -        | no       | Question/answer pairs                                           |
| managerFields | object            | -        | partial  | `person` / `status` / `note` / `date` (the only writable parts) |

> **Attachments / PDF export:** submission attachment retrieval is referenced on the discuss forum but the exact pattern is not cleanly documented. [INFERRED — discovery needed]

### Field-format reference

| Format    | Pattern                | Example          | Notes                                                                        |
| --------- | ---------------------- | ---------------- | ---------------------------------------------------------------------------- |
| Timestamp | Unix epoch **seconds** | `1716969600`     | All `start`/`end`/`*Time`/`createdAt`/`modifiedAt`/`*Timestamp` [DOCUMENTED] |
| Date      | `YYYY-MM-DD`           | `"2026-05-29"`   | Date-only fields (e.g. timesheet ranges) [DOCUMENTED]                        |
| Phone     | E.164                  | `"+14155550101"` | Login identity [INFERRED]                                                    |
| ID        | integer                | `4815162`        | Numeric ids across modules [INFERRED]                                        |

> **#1 integration bug:** Connecteam uses **Unix seconds**, not milliseconds and not ISO-8601, for all activity/shift times. [DOCUMENTED]

---

## Query Parameters

Filtering is **whitelisted per endpoint** — there is no generic query language. Multiple params are AND-combined; there is no OR / nested filtering. [DOCUMENTED params; AND-combination INFERRED]

### `GET /users/v1/users`

| Parameter                                       | Type               | Default  | Description                   |
| ----------------------------------------------- | ------------------ | -------- | ----------------------------- |
| limit                                           | integer (1–500)    | 10       | Page size                     |
| offset                                          | integer (≥0)       | 0        | Start position                |
| sort                                            | string             | —        | Only `created_at` documented  |
| order                                           | enum               | `asc`    | `asc` / `desc`                |
| userIds                                         | array<int>         | —        | Filter by specific user ids   |
| userStatus                                      | enum               | `active` | `active` / `archived` / `all` |
| fullNames                                       | array<string>      | —        | Filter by name                |
| phoneNumbers                                    | array<string>      | —        | Filter by phone               |
| emailAddresses                                  | array<string>      | —        | Filter by email               |
| createdAt / modifiedAt / lastLogin / archivedAt | integer (epoch ≥1) | —        | Time filters                  |

### `GET /forms/v1/forms/{formId}/form-submissions`

| Parameter                | Type          | Default | Description             |
| ------------------------ | ------------- | ------- | ----------------------- |
| userIds                  | array<int>    | —       | Filter by submitter     |
| submittingStartTimestamp | integer (s)   | —       | Window start (epoch s)  |
| submittingEndTime        | integer (s)   | —       | Window end (epoch s)    |
| limit                    | integer 1–100 | 10      | Page size (**max 100**) |
| offset                   | integer ≥0    | 0       | Start position          |

> **Capabilities NOT supported:** full-text search, field selection / sparse fieldsets, `include`-style relation expansion, and comparison operators (`gt`/`lt`). Use explicit from/to params and the child endpoints. [INFERRED]

---

## Pagination

- **Type:** offset / limit [DOCUMENTED]
- **Default page size:** 10 [DOCUMENTED]
- **Max page size:** endpoint-specific — users `500`, form-submissions `100`; no global max published. [DOCUMENTED]
- **Total count:** Not consistently returned — use the "fewer-than-limit" heuristic, not a total. [DOCUMENTED]

**Parameters:**

| Parameter | Type    | Default | Description       |
| --------- | ------- | ------- | ----------------- |
| limit     | integer | 10      | Items per page    |
| offset    | integer | 0       | Starting position |

**Response structure** (envelope keys `requestId`/`paging` are [INFERRED]; only the `data.<resource>` array is confirmed by the pagination guide):

```json
{
  "requestId": "req_8f3c1a",
  "data": {
    "users": [
      /* ... */
    ]
  },
  "paging": { "limit": 10, "offset": 0 }
}
```

**Last page detection:** "Continue incrementing `offset` by `limit` until the response returns **fewer items than the limit**." [DOCUMENTED — verbatim]

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items  (full page → continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items  (full page → continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items  (< limit → LAST PAGE)
```

**Bulk caps:** users create/update ≤ **25**; shift create ≤ **500**; bulk shift delete ≤ **20**. Per-item partial-failure reporting is [UNKNOWN — discovery needed].

---

## Rate Limits

Limits are **per Connecteam account**, shared across **every** API client (this connector plus any other integration) — **not** per token/key.

| Scope (per account) | Limit        | Window | Daily        | Source       |
| ------------------- | ------------ | ------ | ------------ | ------------ |
| SBP plan            | 5 requests   | 1 min  | + 100/day    | [DOCUMENTED] |
| Expert plan         | 100 requests | 1 min  | + 10,000/day | [DOCUMENTED] |
| Enterprise plan     | 200 requests | 1 min  | + 20,000/day | [DOCUMENTED] |

**Headers:**

| Header                         | Meaning                         | Example      |
| ------------------------------ | ------------------------------- | ------------ |
| `x-ratelimit-minute-limit`     | Minute quota                    | `200`        |
| `x-ratelimit-minute-remaining` | Remaining this minute           | `188`        |
| `x-ratelimit-minute-reset`     | Reset (UTC epoch **seconds**)   | `1716969660` |
| `x-ratelimit-day-limit`        | Daily quota                     | `20000`      |
| `x-ratelimit-day-remaining`    | Remaining today                 | `19992`      |
| `x-ratelimit-day-reset`        | Daily reset (UTC epoch seconds) | `1717027200` |

**When exceeded:** `HTTP 429 Too Many Requests` [DOCUMENTED]. Body shape not published [UNKNOWN]. **No `Retry-After` header** — compute the wait from `x-ratelimit-minute-reset`. [UNKNOWN — header not documented]

**Recommended strategy:** exponential backoff on 429 + monitor the `x-ratelimit-*` headers; cache list reads aggressively (on SBP's 5/min you throttle almost immediately). [DOCUMENTED]

---

## Error Handling

**Standard error format** — no global error-schema page was found; the shape below is reconstructed from ReadMe/FastAPI conventions visible in the reference (`422 Validation Error`):

```json
{
  "requestId": "req_8f3c1a",
  "statusCode": 422,
  "message": "Validation error",
  "detail": [{ "loc": ["body", "users", 0, "phoneNumber"], "msg": "field required", "type": "value_error.missing" }]
}
```

[INFERRED — confirm against a live 422]

**Status codes:**

| Status | Meaning          | Retryable | Recovery                                                        |
| ------ | ---------------- | --------- | --------------------------------------------------------------- |
| 200    | Success          | -         | -                                                               |
| 400    | Bad request      | No        | Fix request parameters                                          |
| 401    | Unauthorized     | Yes       | Token expired (24h, no refresh) — re-fetch token and retry once |
| 403    | Forbidden        | No        | Missing scope, or account below the Enterprise plan             |
| 404    | Not found        | No        | Verify id / scheduler / formId; check AU host for AU tenants    |
| 422    | Validation error | No        | Inspect `detail[]` field errors                                 |
| 429    | Rate limited     | Yes       | Back off using `x-ratelimit-minute-reset` (no `Retry-After`)    |
| 5xx    | Server error     | Yes       | Retry with exponential backoff                                  |

---

## Webhooks / Events

**Registration:** `POST /settings/v1/webhooks` (also creatable in the UI Integration Center). [DOCUMENTED]

**Subscription body:**

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

**Event catalog (by feature type):** [DOCUMENTED]

| Feature           | Events                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_restored`, `user_promoted`, `user_demoted` |
| `time_activity`   | `clock_in`, `clock_out` (+ admin/approval variants)                                                               |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created`, `availability_status_deleted`   |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`                                              |
| `tasks`           | `task_published`, `task_completed`                                                                                |

**Verification:** a `secretKey` supplied at registration is used "for webhook signature verification" — the exact signature header/algorithm is **not documented**. [DOCUMENTED — mechanism; UNKNOWN — details]
**Retry policy:** fixed `retryLimit` of 3 attempts. [DOCUMENTED] Ordering/dedup guarantees [UNKNOWN].
**Payload body shape:** **[UNKNOWN — not documented; discovery needed]**.

**Polling fallback (no webhooks):** any list endpoint with a `modifiedAt` epoch-second filter (e.g. `GET /users/v1/users?modifiedAt=…`); poll every few minutes, respecting the per-account minute cap. [DOCUMENTED]

---

## Known Limitations

1. **OAuth flow conflict (build blocker).** The registry's `authorization_code`-style endpoints (`app.connecteam.com/oauth/*`) disagree with the official `client_credentials`-only docs (`api.connecteam.com/oauth/v1/token`). Must be reconciled before build. [DOCUMENTED]
2. **No refresh token** for the documented OAuth flow — re-request a token on expiry (24 h). [DOCUMENTED]
3. **Enterprise-plan gating** — the public API is unavailable below Enterprise. [DOCUMENTED]
4. **Per-account rate limits shared across all clients** — easy to throttle on lower plans. [DOCUMENTED]
5. **92-day cap** on time-activity queries. [DOCUMENTED]
6. **No full-text search, no field selection, no relation expansion.** [INFERRED]
7. **Module-versioned paths** — no global `/v1`; each module carries its own. [DOCUMENTED]
8. **AU data residency** — AU tenants must use `api-au.connecteam.com`. [DOCUMENTED]
9. **No live-tested examples** — response envelopes, error bodies, and webhook payloads are [INFERRED]/[UNKNOWN].
10. **Immutable OAuth scopes** — changing scopes requires a new app. [DOCUMENTED]

---

## SDKs & Tooling

| SDK / Tool      | Language | Repository / URL                                                       | Quality | Notes                                                   |
| --------------- | -------- | ---------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| (none official) | —        | —                                                                      | —       | Docs show raw `requests`/`fetch`/curl only [DOCUMENTED] |
| Pipedream app   | —        | [pipedream.com/apps/connecteam](https://pipedream.com/apps/connecteam) | Fair    | Pre-built actions/triggers [CONFIRMED]                  |

**Postman collection:** None official located. [UNKNOWN]
**OpenAPI spec:** Not located (ReadMe portal likely backed by one). [INFERRED]

---

## Integration Path Assessment

**Recommended path:** **Direct API via `connect_request`** (not a Files connector).

**Justification:** Connecteam exposes **records** (users, time activities, shifts, form submissions, jobs), not a browsable file tree. There is no `list_files`/`download_file` semantic to map onto. The workspace agent calls the REST endpoints through Numa's `connect_request` proxy, which injects the OAuth bearer token from the user's vault. This mirrors how spec-driven API connectors (e.g. simPRO) are wired — not the file-browser providers (Drive/Gmail/OneDrive/Dropbox).

**Connector compatibility (Files-connector methods — for completeness; not used here):**

| Connector Method  | API Endpoint | Feasibility                                |
| ----------------- | ------------ | ------------------------------------------ |
| list_files        | —            | none — Connecteam has no file/folder tree  |
| download_file     | —            | none                                       |
| search_files      | —            | none — value filters on records, not files |
| get_file_metadata | —            | none                                       |

---

_Researched on 2026-05-29. Sources: Connecteam developer portal (developer.connecteam.com — reference, authentication, OAuth 2.0 Beta, changelog pages fetched), help-centre API collection, developer discuss forum, Canny public-API roadmap, Pipedream Connecteam app, and the Numa connector registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`). No live API call was possible — the CRITICAL GATE is not passed; treat envelopes/error bodies/webhook payloads as [INFERRED]/[UNKNOWN]._
