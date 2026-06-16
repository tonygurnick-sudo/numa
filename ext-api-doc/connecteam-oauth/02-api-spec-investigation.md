---
api_name: Connecteam API (OAuth)
api_slug: connecteam-oauth
base_url: https://api.connecteam.com
base_url_au: https://api-au.connecteam.com
path_version_segment: per-module (/users/v1, /time-clock/v1, /scheduler/v1, /forms/v1, /settings/v1); NO global /v1
auth: OAuth 2.0 Bearer token (see Authentication)
field_casing: camelCase
id_format: integer
timestamps: Unix epoch SECONDS
spec_format: none publicly located (ReadMe-hosted; OpenAPI likely backs the portal but URL not found)
docs_url: https://developer.connecteam.com
date_researched: 2026-05-29
call_surface: HTTP via `numa integrations request` (records, not files)
confidence: facts [DOCUMENTED] (vendor docs) unless tagged [CONFIRMED] (live call — almost none, no live OAuth call possible), [INFERRED], or [UNKNOWN]. Treat envelopes/error bodies/webhook payloads as INFERRED/UNKNOWN.
shared_api: same REST API as connecteam-api (API-key). Base URL, endpoint catalog, data models, query/filter, pagination, rate-limit, error, webhook behaviour identical — ONLY the Authentication section differs (OAuth bearer vs `X-API-KEY`). Keep aligned with connecteam-api/02.
---

# Connecteam (OAuth) — API Specification & Investigation

Condensed developer reference for the Connecteam REST API.

## Overview

- **Vendor:** Connecteam Ltd. [CONFIRMED] **API type:** REST, JSON. [CONFIRMED]
- **API version:** `v1`, versioned **per module** in the path (`/users/v1`, `/time-clock/v1`, `/scheduler/v1`, `/forms/v1`, `/settings/v1`). **No global `/v1` prefix.**
- **Base URL:** `https://api.connecteam.com` (global). **AU data residency:** `https://api-au.connecteam.com` — AU-resident tenants MUST use this host.
- **Sandbox:** none — testing uses a live Enterprise account [UNKNOWN — no sandbox documented].
- **Plan gate:** the public API is **Enterprise-plan-only** — on lower plans the API/Integration tabs are not exposed.
- **Docs:** [developer.connecteam.com](https://developer.connecteam.com) (ReadMe-hosted) · [reference](https://developer.connecteam.com/reference) (per-operation pages, slug `{verb}_{operationId}`) · [API-key auth](https://developer.connecteam.com/docs/authentication-1) · [OAuth 2.0 (Beta)](https://developer.connecteam.com/docs/oauth-20) · [changelog](https://developer.connecteam.com/changelog) · [help-centre API articles](https://help.connecteam.com/en/collections/11374088-api-s-integrations) · [discuss](https://developer.connecteam.com/discuss) · [roadmap](https://connecteam.canny.io/publicapi). [all CONFIRMED — fetched]
- **OpenAPI spec:** not located (ReadMe portals usually OpenAPI-backed, but no public `openapi.json` URL found) [INFERRED]. **Status page:** none found [UNKNOWN].

**Summary:** deskless-workforce management (time clock, scheduling, digital forms, tasks, HR). The REST API exposes Users (employees), Time Clock activities & timesheets, Scheduler shifts, Forms & submissions, Jobs/sub-jobs, Attachments, and Webhook subscriptions.

## Authentication

> ⚠️ **The only material divergence from `connecteam-api` — and it contains an unresolved conflict between the Numa registry and Connecteam's official docs. Reconcile before building.** Full setup/reauth in `04-connection-and-reauth.md`.

### Method: OAuth 2.0 (Bearer token)

Numa's registry classifies this `authType: 'oauth2'`. All calls flow through `connect_request`, which injects the bearer token from the user's vault — the agent never performs the token exchange.

Header (every request):

```
Authorization: Bearer {access_token}
Accept: application/json
Content-Type: application/json     ← POST/PUT bodies only
```

### ⚠️ Registry vs official OAuth docs — the conflict

| Aspect            | Numa registry (`connecteam-oauth`)                  | Official Connecteam OAuth 2.0 (Beta) docs                         |
| ----------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| Grant type        | Implies `authorization_code` (carries an `authUrl`) | **`client_credentials` only** (server-to-server, no user consent) |
| Authorization URL | `https://app.connecteam.com/oauth/authorize`        | **None** — client_credentials has no consent endpoint             |
| Token URL         | `https://app.connecteam.com/oauth/token`            | **`https://api.connecteam.com/oauth/v1/token`**                   |
| Client auth       | (standard code exchange)                            | HTTP **Basic** (Client ID = username, Secret = password)          |
| App registration  | "Developer Portal → Create an integration"          | "Your Name → Integration Center → OAuth 2.0 → Create app"         |
| Scopes            | `forms.read attachments.write`                      | `feature.permission`, e.g. `users.read`, `schedule.write`         |

- Registry `authUrl`/`tokenUrl` (`app.connecteam.com/oauth/*`): **[UNKNOWN — unverified]**, treat as placeholders until confirmed.
- Official token endpoint `https://api.connecteam.com/oauth/v1/token`: **[DOCUMENTED]**.

**Implication:** if official docs are accurate, this is a machine-to-machine `client_credentials` integration with **no redirect/consent step**, which doesn't fit Numa's redirect-based OAuth wizard cleanly and overlaps heavily with `connecteam-api`. Resolve before build. See `04` §"Open conflict".

### OAuth 2.0 config (as officially documented — `client_credentials`)

| Parameter             | Value                                                                                   | Source       |
| --------------------- | --------------------------------------------------------------------------------------- | ------------ |
| Grant type            | `client_credentials`                                                                    | [DOCUMENTED] |
| Authorization URL     | N/A for client_credentials (registry value `app.connecteam.com/oauth/authorize`)        | [UNKNOWN]    |
| Token URL             | `https://api.connecteam.com/oauth/v1/token`                                             | [DOCUMENTED] |
| Client authentication | HTTP Basic — `Authorization: Basic base64(clientId:clientSecret)`                       | [DOCUMENTED] |
| Token request body    | `grant_type=client_credentials` (`application/x-www-form-urlencoded`); optional `scope` | [DOCUMENTED] |
| Access token lifetime | **86400 s (24 h)** — `expires_in: 86400`                                                | [DOCUMENTED] |
| Refresh mechanism     | **None** — re-request a token on expiry                                                 | [DOCUMENTED] |
| Revocation URL        | Not documented                                                                          | [UNKNOWN]    |
| PKCE                  | N/A for client_credentials                                                              | [UNKNOWN]    |
| Client Secret         | Shown **once** at app creation — capture immediately                                    | [DOCUMENTED] |
| Scope mutability      | **Immutable after app creation** — change = new app                                     | [DOCUMENTED] |

**Token response:** `{"access_token":"eyJhbGciOi...","token_type":"Bearer","expires_in":86400,"scope":"users.read forms.read"}`

### Required scopes

Format `feature.permission`. Registry currently requests `forms.read attachments.write`. For read-only chat, request the read scope per module you query.
| Scope | Purpose | Required for Numa? |
| --- | --- | --- |
| `users.read` | Read users / employees | Recommended (read-only chat) |
| `schedule.read` | Read schedulers & shifts | Recommended |
| `timeclock.read` _ | Read time clocks / activities / timesheets | Recommended (_ exact slug unverified) [INFERRED] |
| `forms.read` | Read forms & submissions | Yes — in registry |
| `attachments.write` | Upload attachments | In registry; a **write** scope — reconsider for read-only chat |
| `users.write` | Create / update users | Only if mutations enabled |
| `schedule.write` | Create / update shifts | Only if mutations enabled |
| `schedule.delete` | Delete shifts | Avoid unless explicitly needed |

> **Scope gotcha:** scopes are **frozen at app-creation**. Pick the full read set (plus required writes) up front, or you must register a new app.

### API-key auth (sibling `connecteam-api` connector — for cross-consistency)

| Parameter     | Value                                                                  | Source       |
| ------------- | ---------------------------------------------------------------------- | ------------ |
| Header        | `X-API-KEY: {key}`                                                     | [DOCUMENTED] |
| How to obtain | Settings → API Keys → "Add API key" (owner / Enterprise)               | [DOCUMENTED] |
| Smoke test    | `curl --url 'https://api.connecteam.com/me' --header 'X-API-KEY: ...'` | [DOCUMENTED] |

## Endpoint Catalog

All `Auth: Yes`. `/me` is the only path without a module prefix; use it to confirm credentials. Confidence: [D]=DOCUMENTED, [I]=INFERRED.

| #   | Method | Path                                                          | Purpose                          | Paginated | Idempotent | Conf                                       |
| --- | ------ | ------------------------------------------------------------- | -------------------------------- | --------- | ---------- | ------------------------------------------ |
| 1   | GET    | /me                                                           | Identity smoke test              | No        | Yes        | D                                          |
| 2   | GET    | /users/v1/users                                               | List users (filters)             | Yes       | Yes        | D                                          |
| 3   | GET    | /users/v1/users/{userId}                                      | Get single user                  | No        | Yes        | I                                          |
| 4   | POST   | /users/v1/users                                               | Create users (batch ≤25)         | No        | No         | D                                          |
| 5   | PUT    | /users/v1/users                                               | Update users (batch)             | No        | Yes        | I                                          |
| 6   | GET    | /time-clock/v1/time-clocks                                    | List time clocks                 | Yes       | Yes        | D                                          |
| 7   | GET    | /time-clock/v1/time-clocks/{id}/time-activities               | List activities (≤92-day window) | Yes       | Yes        | D                                          |
| 8   | POST   | /time-clock/v1/time-clocks/{id}/time-activities               | Create time activities           | No        | No         | D                                          |
| 9   | PUT    | /time-clock/v1/time-clocks/{id}/time-activities               | Update time activities           | No        | Yes        | D                                          |
| 10  | POST   | /time-clock/v1/time-clocks/{id}/clock-in                      | Real-time clock-in               | No        | No         | D                                          |
| 11  | POST   | /time-clock/v1/time-clocks/{id}/clock-out                     | Real-time clock-out              | No        | No         | D                                          |
| 12  | GET    | /time-clock/v1/time-clocks/{id}/timesheet                     | Aggregated payroll summary       | Yes       | Yes        | D                                          |
| 13  | GET    | /scheduler/v1/schedulers                                      | List schedulers                  | Yes       | Yes        | D                                          |
| 14  | GET    | /scheduler/v1/schedulers/{sid}/shifts                         | List shifts (filters)            | Yes       | Yes        | D                                          |
| 15  | GET    | /scheduler/v1/schedulers/{sid}/shifts/{shiftId}               | Get single shift                 | No        | Yes        | D                                          |
| 16  | POST   | /scheduler/v1/schedulers/{sid}/shifts                         | Create shifts (≤500)             | No        | No         | D                                          |
| 17  | PUT    | /scheduler/v1/schedulers/{sid}/shifts                         | Update shifts (bulk)             | No        | Yes        | D                                          |
| 18  | DELETE | /scheduler/v1/schedulers/{sid}/shifts                         | Delete shifts (bulk ≤20)         | No        | Yes        | D                                          |
| 19  | DELETE | /scheduler/v1/schedulers/{sid}/shifts/{shiftId}               | Delete single shift              | No        | Yes        | D                                          |
| 20  | GET    | /scheduler/v1/schedulers/{sid}/shift-layers                   | List shift layers                | Yes       | Yes        | D                                          |
| 21  | GET    | /scheduler/v1/schedulers/{sid}/shift-layers/{layerId}/values  | Layer values                     | Yes       | Yes        | D                                          |
| 22  | GET    | /scheduler/v1/schedulers/user-unavailability                  | User unavailabilities            | Yes       | Yes        | D                                          |
| 23  | POST   | /scheduler/v1/schedulers/{sid}/unavailability                 | Add unavailability               | No        | No         | D                                          |
| 24  | DELETE | /scheduler/v1/schedulers/{sid}/unavailability/{uid}           | Remove unavailability            | No        | Yes        | D                                          |
| 25  | POST   | /scheduler/v1/schedulers/{sid}/shifts/auto-assign             | Start auto-assign (async)        | No        | No         | D                                          |
| 26  | GET    | /scheduler/v1/schedulers/{sid}/shifts/auto-assign/{requestId} | Poll auto-assign result          | No        | Yes        | D                                          |
| 27  | GET    | /forms/v1/forms                                               | List forms                       | Yes       | Yes        | D                                          |
| 28  | GET    | /forms/v1/forms/{formId}                                      | Get a form                       | No        | Yes        | D                                          |
| 29  | GET    | /forms/v1/forms/{formId}/form-submissions                     | List submissions (filters)       | Yes       | Yes        | D                                          |
| 30  | GET    | /forms/v1/forms/{formId}/form-submissions/{id}                | Get single submission            | No        | Yes        | I                                          |
| 31  | PUT    | /forms/v1/forms/{formId}/form-submissions/{id}                | Update manager fields only       | No        | Yes        | I                                          |
| 32  | GET    | /jobs/v1/jobs (+ sub-jobs)                                    | List jobs / sub-jobs             | Yes       | Yes        | I (module exists; exact paths not fetched) |
| 33  | POST   | /attachments/v1/...                                           | Upload an attachment             | No        | No         | I (`attachments.write` scope exists)       |
| 34  | POST   | /settings/v1/webhooks                                         | Create a webhook subscription    | No        | No         | D                                          |

**Per-module notes:**

- **Users:** batch actions capped at **25 per request**.
- **Time Clock:** **time-activity queries limited to a 92-day (3-month) window**; a wider `start`/`end` range is rejected.
- **Scheduler:** **unsupported features** (data layers, shift tasks, repeating shifts, group shifts) are explicitly **not** writable via API. **Auto-assign is the only async/polling pattern** in the whole API.
- **Forms:** only **manager fields** (person/status/note/date) are writable on a submission; answer entries are read-only.

## Data Models

> Field names from reference overview pages; types `[INFERRED]` where the JSON schema is hidden behind ReadMe's "Try It" widget.

### User (Employee) [fields DOCUMENTED; types INFERRED]

| Field        | Type              | Required | Writable | Description                | Example                  |
| ------------ | ----------------- | -------- | -------- | -------------------------- | ------------------------ |
| userId       | integer           | —        | no       | Unique id                  | `4815162`                |
| firstName    | string            | yes      | yes      | Given name                 | `"Jane"`                 |
| lastName     | string            | yes      | yes      | Family name                | `"Doe"`                  |
| phoneNumber  | string (E.164)    | yes      | yes      | Login identity (phone-led) | `"+14155550101"`         |
| email        | string            | no       | yes      | Email                      | `"jane@acme.com"`        |
| userType     | enum              | no       | yes      | `user`/`manager`/`admin`   | `"user"`                 |
| userStatus   | enum              | no       | no       | `active`/`archived`        | `"active"`               |
| customFields | array<object>     | no       | yes      | Tenant-defined             | `[{"id":1,"value":"…"}]` |
| createdAt    | integer (epoch s) | —        | no       | Creation ts                | `1716950400`             |
| modifiedAt   | integer (epoch s) | —        | no       | Last-modified ts           | `1716950400`             |

Relationships: a User is the `assignee` of Shifts, the `userId` on Time Activities, and the submitter of Form Submissions.

### Time Activity (Shift / Break / Time-off) [fields DOCUMENTED]

| Field       | Type              | Required | Writable | Description               | Example      |
| ----------- | ----------------- | -------- | -------- | ------------------------- | ------------ |
| timeClockId | integer           | yes      | no       | Parent time-clock (path)  | `12345`      |
| userId      | integer           | yes      | yes      | Employee                  | `4815162`    |
| start       | integer (epoch s) | yes      | yes      | Start (Unix **seconds**)  | `1716969600` |
| end         | integer (epoch s) | no       | yes      | End; absent if open       | `1716998400` |
| type        | enum              | yes      | yes      | `shift`/`break`/`timeoff` | `"shift"`    |

Relationships: belongs to a Time Clock (path), references a User by `userId`. No `end` = "open" (clocked-in).

### Shift [fields DOCUMENTED; exact slugs INFERRED]

| Field        | Type              | Required | Writable | Description                         | Example       |
| ------------ | ----------------- | -------- | -------- | ----------------------------------- | ------------- |
| shiftId      | integer/string    | —        | no       | Unique id                           | `987654`      |
| schedulerId  | integer           | yes      | no       | Parent scheduler (path)             | `321`         |
| type         | enum              | no       | yes      | `regular`/`open`/`draft`/`group`    | `"regular"`   |
| assignees    | array<integer>    | no       | yes      | userIds assigned                    | `[4815162]`   |
| startTime    | integer (epoch s) | yes      | yes      | Start                               | `1716969600`  |
| endTime      | integer (epoch s) | yes      | yes      | End                                 | `1716998400`  |
| status       | enum              | no       | yes      | `published`/`draft`                 | `"published"` |
| shiftLayers  | array<object>     | no       | yes      | Layer values (jobs/locations/notes) | `[…]`         |
| customFields | array<object>     | no       | yes      | Tenant-defined                      | `[…]`         |

Relationships: belongs to a Scheduler (path); `assignees` reference Users; `shiftLayers` can reference Jobs.

### Form Submission [INFERRED — response schema not exposed]

| Field         | Type              | Writable | Description                                               |
| ------------- | ----------------- | -------- | --------------------------------------------------------- |
| submissionId  | integer/string    | no       | Unique id                                                 |
| formId        | integer           | no       | Parent form                                               |
| userId        | integer           | no       | Submitting user                                           |
| submittedAt   | integer (epoch s) | no       | Submission ts                                             |
| entries       | array<object>     | no       | Question/answer pairs                                     |
| managerFields | object            | partial  | `person`/`status`/`note`/`date` (the only writable parts) |

> **Attachments / PDF export:** referenced on the discuss forum but the exact pattern isn't cleanly documented [INFERRED — discovery needed].

### Field-format reference

| Format    | Pattern                | Example          | Notes                                                           |
| --------- | ---------------------- | ---------------- | --------------------------------------------------------------- |
| Timestamp | Unix epoch **seconds** | `1716969600`     | All `start`/`end`/`*Time`/`createdAt`/`modifiedAt`/`*Timestamp` |
| Date      | `YYYY-MM-DD`           | `"2026-05-29"`   | Date-only fields (e.g. timesheet ranges)                        |
| Phone     | E.164                  | `"+14155550101"` | Login identity [INFERRED]                                       |
| ID        | integer                | `4815162`        | Numeric ids across modules [INFERRED]                           |

> **#1 integration bug:** Unix **seconds**, not milliseconds, not ISO-8601, for all activity/shift times.

## Query Parameters

Filtering is **whitelisted per endpoint** — no generic query language. Multiple params AND-combined; no OR / nesting [params DOCUMENTED; AND-combination INFERRED].

### `GET /users/v1/users`

| Parameter                                       | Type               | Default  | Description                  |
| ----------------------------------------------- | ------------------ | -------- | ---------------------------- |
| limit                                           | integer (1–500)    | 10       | Page size                    |
| offset                                          | integer (≥0)       | 0        | Start position               |
| sort                                            | string             | —        | Only `created_at` documented |
| order                                           | enum               | `asc`    | `asc`/`desc`                 |
| userIds                                         | array<int>         | —        | Specific user ids            |
| userStatus                                      | enum               | `active` | `active`/`archived`/`all`    |
| fullNames                                       | array<string>      | —        | Filter by name               |
| phoneNumbers                                    | array<string>      | —        | Filter by phone              |
| emailAddresses                                  | array<string>      | —        | Filter by email              |
| createdAt / modifiedAt / lastLogin / archivedAt | integer (epoch ≥1) | —        | Time filters                 |

### `GET /forms/v1/forms/{formId}/form-submissions`

| Parameter                | Type          | Default | Description             |
| ------------------------ | ------------- | ------- | ----------------------- |
| userIds                  | array<int>    | —       | Filter by submitter     |
| submittingStartTimestamp | integer (s)   | —       | Window start (epoch s)  |
| submittingEndTime        | integer (s)   | —       | Window end (epoch s)    |
| limit                    | integer 1–100 | 10      | Page size (**max 100**) |
| offset                   | integer ≥0    | 0       | Start position          |

> **NOT supported:** full-text search, field selection / sparse fieldsets, `include` relation expansion, comparison operators (`gt`/`lt`). Use explicit from/to params and child endpoints [INFERRED].

## Pagination

- **Type:** offset/limit. **Default page size:** 10. **Max page size:** endpoint-specific (users `500`, form-submissions `100`; no global max published). **Total count:** not consistently returned — use the "fewer-than-limit" heuristic.

| Parameter | Type    | Default | Description       |
| --------- | ------- | ------- | ----------------- |
| limit     | integer | 10      | Items per page    |
| offset    | integer | 0       | Starting position |

**Response shape** (envelope keys `requestId`/`paging` [INFERRED]; only the `data.<resource>` array confirmed):
`{"requestId":"req_8f3c1a","data":{"users":[/* ... */]},"paging":{"limit":10,"offset":0}}`

**Last page detection** (verbatim): "Continue incrementing `offset` by `limit` until the response returns **fewer items than the limit**."

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items  (continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items  (continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items  (< limit → LAST PAGE)
```

**Bulk caps:** users create/update ≤**25**; shift create ≤**500**; bulk shift delete ≤**20**. Per-item partial-failure reporting [UNKNOWN — discovery needed].

## Rate Limits

**Per Connecteam account**, shared across **every** API client (this connector + any other integration) — **not** per token/key.
| Plan | Per-minute | Per-day | Source |
| --- | --- | --- | --- |
| SBP | 5 | 100 | [DOCUMENTED] |
| Expert | 100 | 10,000 | [DOCUMENTED] |
| Enterprise | 200 | 20,000 | [DOCUMENTED] |

**Headers:**
| Header | Meaning | Example |
| --- | --- | --- |
| `x-ratelimit-minute-limit` | Minute quota | `200` |
| `x-ratelimit-minute-remaining` | Remaining this minute | `188` |
| `x-ratelimit-minute-reset` | Reset (UTC epoch **seconds**) | `1716969660` |
| `x-ratelimit-day-limit` | Daily quota | `20000` |
| `x-ratelimit-day-remaining` | Remaining today | `19992` |
| `x-ratelimit-day-reset` | Daily reset (UTC epoch seconds) | `1717027200` |

**When exceeded:** `HTTP 429 Too Many Requests`. Body shape not published [UNKNOWN]. **No `Retry-After` header** — compute the wait from `x-ratelimit-minute-reset` [UNKNOWN — header not documented]. **Strategy:** exponential backoff on 429 + monitor `x-ratelimit-*`; cache list reads aggressively (on SBP's 5/min you throttle almost immediately).

## Error Handling

**Standard error format** — no global error-schema page found; reconstructed from ReadMe/FastAPI conventions visible in the reference (`422 Validation Error`) [INFERRED — confirm against a live 422]:
`{"requestId":"req_8f3c1a","statusCode":422,"message":"Validation error","detail":[{"loc":["body","users",0,"phoneNumber"],"msg":"field required","type":"value_error.missing"}]}`

| Status | Meaning          | Retryable | Recovery                                                        |
| ------ | ---------------- | --------- | --------------------------------------------------------------- |
| 200    | Success          | —         | —                                                               |
| 400    | Bad request      | No        | Fix request parameters                                          |
| 401    | Unauthorized     | Yes       | Token expired (24h, no refresh) — re-fetch token and retry once |
| 403    | Forbidden        | No        | Missing scope, or account below the Enterprise plan             |
| 404    | Not found        | No        | Verify id / scheduler / formId; check AU host for AU tenants    |
| 422    | Validation error | No        | Inspect `detail[]` field errors                                 |
| 429    | Rate limited     | Yes       | Back off using `x-ratelimit-minute-reset` (no `Retry-After`)    |
| 5xx    | Server error     | Yes       | Retry with exponential backoff                                  |

## Webhooks / Events

**Registration:** `POST /settings/v1/webhooks` (also creatable in the UI Integration Center). Subscription body:
`{"name":"Numa user sync","url":"https://example.com/hooks/connecteam","feature":"users","events":["user_created","user_updated"],"secretKey":"whsec_…","retryLimit":3}`

**Event catalog (by feature):**
| Feature | Events |
| --- | --- |
| `users` | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_restored`, `user_promoted`, `user_demoted` |
| `time_activity` | `clock_in`, `clock_out` (+admin/approval variants) |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created`, `availability_status_deleted` |
| `forms` | `form_submission`, `form_submission_edited`, `manager_field_updated` |
| `tasks` | `task_published`, `task_completed` |

**Verification:** `secretKey` is "for webhook signature verification" — exact signature header/algorithm **not documented** [mechanism DOCUMENTED; details UNKNOWN]. **Retry policy:** fixed `retryLimit` of 3. Ordering/dedup guarantees [UNKNOWN]. **Payload body shape: [UNKNOWN — not documented; discovery needed].**

**Polling fallback (no webhooks):** any list endpoint with a `modifiedAt` epoch-second filter (e.g. `GET /users/v1/users?modifiedAt=…`); poll every few minutes, respecting the per-account minute cap.

## Known Limitations

1. **OAuth flow conflict (build blocker).** Registry's `authorization_code`-style endpoints (`app.connecteam.com/oauth/*`) disagree with the official `client_credentials`-only docs (`api.connecteam.com/oauth/v1/token`). Reconcile before build.
2. **No refresh token** for the documented OAuth flow — re-request on expiry (24h).
3. **Enterprise-plan gating** — public API unavailable below Enterprise.
4. **Per-account rate limits shared across all clients** — easy to throttle on lower plans.
5. **92-day cap** on time-activity queries.
6. **No full-text search, no field selection, no relation expansion** [INFERRED].
7. **Module-versioned paths** — no global `/v1`.
8. **AU data residency** — AU tenants must use `api-au.connecteam.com`.
9. **No live-tested examples** — response envelopes, error bodies, webhook payloads are [INFERRED]/[UNKNOWN].
10. **Immutable OAuth scopes** — changing scopes requires a new app.

## SDKs & Tooling

| SDK / Tool      | Repository / URL                                                       | Notes                                      |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| (none official) | —                                                                      | Docs show raw `requests`/`fetch`/curl only |
| Pipedream app   | [pipedream.com/apps/connecteam](https://pipedream.com/apps/connecteam) | Pre-built actions/triggers [CONFIRMED]     |

**Postman collection:** none official located [UNKNOWN]. **OpenAPI spec:** not located (ReadMe portal likely backed by one) [INFERRED].

## Integration Path Assessment

**Recommended path: Direct API via `connect_request`** (not a Files connector). Connecteam exposes **records** (users, time activities, shifts, form submissions, jobs), not a browsable file tree — no `list_files`/`download_file` semantic to map. The agent calls REST endpoints through `connect_request`, which injects the OAuth bearer token from the user's vault. Mirrors spec-driven API connectors (e.g. simPRO), not the file-browser providers (Drive/Gmail/OneDrive/Dropbox).

Files-connector methods (for completeness; **not used here**): `list_files`/`download_file`/`search_files`/`get_file_metadata` — all none (no file/folder tree; value filters on records, not files).

---

_Researched 2026-05-29 from the Connecteam developer portal (reference, authentication, OAuth 2.0 Beta, changelog), help-centre API collection, discuss forum, Canny roadmap, Pipedream app, and the Numa connector registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`). No live API call was possible — the CRITICAL GATE is not passed; treat envelopes/error bodies/webhook payloads as [INFERRED]/[UNKNOWN]._
