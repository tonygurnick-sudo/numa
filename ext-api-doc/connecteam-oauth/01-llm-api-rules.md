---
api_name: Connecteam API (OAuth)
api_slug: connecteam-oauth
base_url: https://api.connecteam.com
base_url_au: https://api-au.connecteam.com
path_version_segment: per-module (e.g. /users/v1, /time-clock/v1) — there is NO global /v1; do not prepend /v1
route_prefix_injected_by_connector: none (pass the full module path as written below)
auth: Bearer {access_token} (24h, no refresh token; injected by connect_request)
field_casing: camelCase
id_format: integer
timestamps: Unix epoch SECONDS (not ms, not ISO-8601)
rate_limit: per ACCOUNT (shared by all clients), not per token — Enterprise 200/min+20k/day, Expert 100/min+10k/day, SBP 5/min+100/day
plan_gate: Enterprise-plan only
call_surface: HTTP via `numa integrations request` (records, not files — NOT a file-browse connector; no list-files/download-file)
confidence: facts are [DOCUMENTED] (vendor docs) unless tagged [INFERRED]/[UNKNOWN]. NO live API call was possible — envelopes/error bodies/webhook payloads are unverified.
shared_api: same REST API as connecteam-api (API-key); only auth differs. Keep 01a/01b/01c aligned across both.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Connecteam (OAuth) — API Rules

## Paths (read first)

- Module-versioned: `/users/v1/...`, `/time-clock/v1/...`, `/scheduler/v1/...`, `/forms/v1/...`, `/settings/v1/...`. NO global `/v1`. Don't write `/v1/users`.
- `/me` is the ONLY path with no module prefix.
- AU-resident tenants MUST target `https://api-au.connecteam.com` (both token endpoint and API calls). If an AU customer 401s/404s unexpectedly, switch host.

## Auth

```
Authorization: Bearer {access_token}
Accept: application/json
Content-Type: application/json   (POST/PUT bodies only)
```

- `connect_request` injects the token from the user's vault — the agent never does the token exchange.
- Token is 24h with **no refresh token**. 401 = expired → `connect_request` re-fetches; just retry once.
- Official flow is `client_credentials` (token URL `https://api.connecteam.com/oauth/v1/token`, HTTP Basic clientId:secret). Scopes are `feature.permission` (`users.read`, `schedule.write`) and **immutable after app creation** (change = new app). Registry default scopes `forms.read attachments.write` are read-skewed → most writes 403 unless the app was created with broader scopes.

## CAN

- List/search **users** by status/name/phone/email (offset/limit). Get user by id.
- Read **time clocks**, **time activities** (type ∈ shift/break/timeoff), **timesheet** summaries (≤92-day window).
- List **schedulers**, query **shifts** by date range, read **user unavailability**.
- List **forms**, read/filter **form submissions** (by user/date).
- Read **jobs / sub-jobs** for categorisation [paths INFERRED].
- (With write scopes) create users, create/clock-in/clock-out time activities, create/update shifts, update form manager fields — **always confirm with the user first**.

## CANNOT

- Delete users/shifts/unavailability without explicit confirmation (destructive).
- Full-text search (only whitelisted exact-match field filters per endpoint). No fuzzy/wildcard.
- Field selection/sparse fields or `include` relation expansion — use child endpoints.
- Exceed batch caps (users ≤25, shift-create ≤500, shift-delete ≤20) or the 92-day activity window.
- Cross data-residency: AU tenants MUST use `api-au.connecteam.com`.
- Browse files — Connecteam exposes records, not a file tree; this connector does NOT support file-browse (`list-files`/`download-file`).

## Critical Gotchas

1. **Timestamps are Unix epoch SECONDS** (not ms, not ISO-8601). All `start`,`end`,`startTime`,`endTime`,`createdAt`,`modifiedAt`,`*Timestamp` filters. #1 integration bug.
2. **Rate limits are per ACCOUNT, shared across every API client** (not per token). On SBP (5/min) you throttle almost instantly. Cache list reads aggressively (~5 min).
3. **92-day cap on time-activity queries.** Wider `startTime`/`endTime` window is rejected — split into ≤90-day chunks.
4. **Module-versioned paths** — see Paths above.
5. **No total count** in list responses. Detect last page with the "fewer-than-limit" heuristic.
6. **No refresh token** — 401 = 24h token expired; `connect_request` re-fetches, retry once.
7. **AU tenants use a different host** (`api-au.connecteam.com`).
8. **Phone-led identity** — users keyed on E.164 phone; creating a user generally requires a valid `phoneNumber`. [INFERRED]

## Default Parameters (override only if the user specifies)

| Parameter   | Default  | Reason                                     |
| ----------- | -------- | ------------------------------------------ |
| limit       | 100      | fewer round-trips, under per-endpoint caps |
| offset      | 0        | first page                                 |
| order       | `desc`   | most-recent-first                          |
| userStatus  | `active` | pass `all`/`archived` only when asked      |
| date window | ≤90 days | inside the 92-day activity cap             |

## Operations

| Operation              | Method | Path                                                   | Key params / notes                                                                                          |
| ---------------------- | ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Identity smoke test    | GET    | /me                                                    | —                                                                                                           |
| List users             | GET    | /users/v1/users                                        | limit, offset, sort(`created_at` only), order, userStatus, userIds, fullNames, phoneNumbers, emailAddresses |
| Get user               | GET    | /users/v1/users/{userId}                               | [INFERRED]                                                                                                  |
| Create users (≤25)     | POST   | /users/v1/users                                        | body `users[]`; `?sendActivation`                                                                           |
| Update users           | PUT    | /users/v1/users                                        | body `users[]` [INFERRED]                                                                                   |
| List time clocks       | GET    | /time-clock/v1/time-clocks                             | limit, offset                                                                                               |
| List time activities   | GET    | /time-clock/v1/time-clocks/{id}/time-activities        | startTime, endTime (≤92d), userId                                                                           |
| Create time activities | POST   | /time-clock/v1/time-clocks/{id}/time-activities        | body `timeActivities[]`                                                                                     |
| Clock in / out         | POST   | /time-clock/v1/time-clocks/{id}/clock-in \| /clock-out | body `{userId}`                                                                                             |
| Timesheet summary      | GET    | /time-clock/v1/time-clocks/{id}/timesheet              | date range                                                                                                  |
| List schedulers        | GET    | /scheduler/v1/schedulers                               | limit, offset                                                                                               |
| List shifts            | GET    | /scheduler/v1/schedulers/{sid}/shifts                  | startTime, endTime, limit, offset                                                                           |
| Create shifts (≤500)   | POST   | /scheduler/v1/schedulers/{sid}/shifts                  | body `shifts[]`                                                                                             |
| Delete shifts (≤20)    | DELETE | /scheduler/v1/schedulers/{sid}/shifts                  | body `shiftIds[]`                                                                                           |
| User unavailability    | GET    | /scheduler/v1/schedulers/user-unavailability           | limit, offset                                                                                               |
| List forms             | GET    | /forms/v1/forms                                        | limit, offset                                                                                               |
| List form submissions  | GET    | /forms/v1/forms/{formId}/form-submissions              | userIds, submittingStartTimestamp, submittingEndTime, limit (max 100), offset                               |
| List jobs / sub-jobs   | GET    | /jobs/v1/jobs                                          | limit, offset [INFERRED]                                                                                    |
| Create webhook         | POST   | /settings/v1/webhooks                                  | body `{name,url,feature,events,secretKey,retryLimit}`                                                       |

## Pagination

offset/limit. Default page size **10** — always set `limit` explicitly. Max page size endpoint-specific: users `500`, form-submissions `100`; others [UNKNOWN] default 100. **No total count** — increment `offset` by `limit` until a response returns fewer items than `limit` (= last page).

```
GET /users/v1/users?limit=500&offset=0    -> 500 items (continue)
GET /users/v1/users?limit=500&offset=500  -> 500 items (continue)
GET /users/v1/users?limit=500&offset=1000 -> 137 items (< limit → LAST PAGE)
```

Response shape: `{"data":{"<resource>":[...]}}` (e.g. `data.users`). `requestId`/`paging` keys [INFERRED].

## Webhooks / Events

Register via `POST /settings/v1/webhooks`, body `{name,url(HTTPS),feature,events[],secretKey,retryLimit}`. `secretKey` = signature verification (algorithm UNKNOWN); `retryLimit` fixed at 3. Payload body shape **UNKNOWN**. `feature` must match its events:
| Feature | Events |
| --- | --- |
| `users` | `user_created`,`user_updated`,`user_deleted`,`user_archived`,`user_restored` |
| `time_activity` | `clock_in`,`clock_out` (+approval variants) |
| `shift_scheduler` | `shift_created`,`shift_updated`,`shift_deleted` |
| `forms` | `form_submission`,`form_submission_edited`,`manager_field_updated` |
| `tasks` | `task_published`,`task_completed` |
**Polling fallback:** any list endpoint with a `modifiedAt` epoch-second filter; poll every few minutes (respect the per-account minute cap).

## Errors

Standard format [INFERRED — FastAPI/ReadMe-style; confirm against a live 422]:
`{"requestId":"req_8f3c1a","statusCode":422,"message":"Validation error","detail":[{"loc":["body","users",0,"phoneNumber"],"msg":"field required","type":"value_error.missing"}]}`

Recovery: 400 fix params · 401 token expired (24h, no refresh) — retry once, `connect_request` re-fetches · 403 missing scope (immutable → new app) OR below Enterprise plan · 404 verify id/scheduler/formId, check AU host · 422 inspect `detail[]` · 429 back off via `x-ratelimit-minute-reset` (no `Retry-After`) · 5xx exponential backoff.

Rate-limit headers: `x-ratelimit-minute-limit/-remaining/-reset`, `x-ratelimit-day-limit/-remaining/-reset` (reset = UTC epoch seconds).

## Examples

1. List active users, newest first:
   `GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=100&offset=0`
   → `{"requestId":"req_8f3c1a","data":{"users":[{"userId":4815162,"firstName":"Jane","lastName":"Doe","phoneNumber":"+14155550101","email":"jane@acme.com","userType":"user","userStatus":"active","createdAt":1716950400,"modifiedAt":1716950400}]},"paging":{"limit":100,"offset":0}}`

2. Time activities for a clock (within 92-day window):
   `GET /time-clock/v1/time-clocks/12345/time-activities?startTime=1714521600&endTime=1717113600&limit=100`
   → `{"data":{"timeActivities":[{"userId":4815162,"type":"shift","start":1716969600,"end":1716998400},{"userId":4815162,"type":"break","start":1716980400,"end":1716982200}]}}`

3. Shifts for a scheduler over a pay period:
   `GET /scheduler/v1/schedulers/321/shifts?startTime=1716163200&endTime=1717372800&limit=100`
   → `{"data":{"shifts":[{"shiftId":987654,"schedulerId":321,"type":"regular","assignees":[4815162],"startTime":1716969600,"endTime":1716998400,"status":"published"}]}}`

4. Form submissions for specific users in a date window (`limit` max **100**, not 500):
   `GET /forms/v1/forms/555/form-submissions?userIds=4815162&submittingStartTimestamp=1714521600&submittingEndTime=1717200000&limit=100`
   → `{"data":{"formSubmissions":[{"submissionId":90001,"formId":555,"userId":4815162,"submittedAt":1716000000,"managerFields":{"status":"approved"}}]}}`
