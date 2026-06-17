---
api_name: Connecteam (API Key)
api_slug: connecteam-api
base_url: https://api.connecteam.com
path_construction: pass full module-versioned path, e.g. /users/v1/users; the proxy adds nothing
path_version_segment: per-module (each module owns its segment — /users/v1, /time_clock/v1, /scheduler/v1 + /scheduler/v2, /jobs/v1, /forms/v1, /settings/v1); NO global /v1; /me is the only unversioned path
path_style: underscores not hyphens (time_clock, form_submissions); never /v1/users
auth: X-API-KEY header (static account key; NOT Authorization: Bearer)
field_casing: camelCase
id_format: MIXED — int (users/clocks/schedulers/customFields), UUID (jobs), 24-char hex (shifts); never coerce
timestamps: Unix epoch SECONDS everywhere (not ms, not ISO-8601); EXCEPT time-activity startDate/endDate = YYYY-MM-DD
rate_limit: per ACCOUNT shared across all keys/integrations — SBP 5/min·100/day, Expert 100/min·10k/day, Enterprise 200/min·20k/day
plan_gate: API needs Expert+; Forms API Enterprise-only
call_surface: HTTP via `numa integrations request` through connect_request proxy (NOT a Files connector — no list/download)
shared_api: same REST API as connecteam-oauth; ONLY auth differs (X-API-KEY here vs Bearer there) — keep 01a/01b/01c in sync
confidence: facts are [DOCUMENTED] from vendor docs unless tagged [INFERRED]/[UNKNOWN]; NO live call made
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Connecteam (API Key) — API Rules

## Paths (read first)

- Pass full module-versioned paths: `/users/v1/users`, `/time_clock/v1/time_clocks/{id}/time_activities`. `connect_request` prepends nothing — send the exact path.
- Version is **per module**: `/users/v1`, `/time_clock/v1`, `/scheduler/v1` **and** `/scheduler/v2`, `/jobs/v1`, `/forms/v1`, `/settings/v1`. **NO** global `/v1`; `/v1/users` is wrong.
- `/me` is the **only** unversioned/unprefixed path.
- Underscores, not hyphens: `time_clock`, `form_submissions`, `clock_in`. Full-URL form is equivalent: `https://api.connecteam.com/users/v1/users`.

## Call surface

HTTP via `numa integrations request`. NOT a Files connector — no `list-files`/`download-file`/`search-files`.

## Auth

```
X-API-KEY: {api_token}
Accept: application/json
Content-Type: application/json   (POST/PUT bodies only)
```

- Static account-level key, **never expires**, no refresh, no `expires_in`. `connect_request` injects it; agent never sees the raw key — never log/echo it.
- Minted by an **account owner**: web app → **Settings → API Keys → Add API key** (Expert+ account). Rotation manual.
- **NOT** `Authorization: Bearer …` — that is the `connecteam-oauth` path (a 24h `client_credentials` bearer token; this one sends `X-API-KEY`).

## CAN

List/search **users** (status/name/phone/email filters). Read **time clocks**, **time activities** (shift/manual_break/time_off, ≤92-day window), **timesheet** summaries. List **schedulers** (V1+V2), query **shifts** by time window, read **user unavailability**. List **forms** + read/filter **form submissions** (Enterprise-only). Read/manage **jobs/sub-jobs** (UUID ids). Writes (confirm with user first): create users; create/clock-in/clock-out/update time activities; create/update/delete shifts; add/remove unavailability; create/update jobs; update form-submission **manager fields**; manage webhooks.

## CANNOT

Full-text search (only whitelisted exact-match filters per endpoint). Sparse-fields/`include`/relation-expand (fetch child endpoints separately). Idempotency keys (clock-in/out + create-users non-idempotent — guard double-submit, verify with GET). Exceed batch caps (users ≤25 · shift-create ≤500 · shift-delete ≤20) or the 92-day activity window. Edit form **answer** entries (manager fields only). Create group/repeating/task/data-layer shifts via API. Use features above the plan (Forms=Enterprise; SBP throttled to 5/min).

## Critical Gotchas

1. **Timestamps are Unix epoch SECONDS** — `start`,`end`,`startTime`,`endTime`,`createdAt`,`modifiedAt`, all `*Timestamp` filters, rate-limit resets. NOT ms, NOT ISO-8601. #1 integration bug. Exception: time-activity `startDate`/`endDate` are `YYYY-MM-DD` strings.
2. **Mixed ID types — never coerce.** Users/clocks/schedulers/customFields = **integer**; jobs = **UUID string**; scheduler shifts = **24-char hex string**.
3. **Module-versioned underscore paths.** No global `/v1`. `/users/v1/...`, `/scheduler/v2/...`, `time_clock`/`form_submissions` (underscore).
4. **Rate limits per ACCOUNT, shared across every key/integration** — not per key. On SBP (5/min) you throttle almost instantly. Cache list reads; throttle on `x-ratelimit-*-remaining`.
5. **92-day cap on time-activity queries.** Wider `startDate`/`endDate` rejected — chunk into ≤90-day windows.
6. **No total count.** Last page = array shorter than `limit`.
7. **`paging` location varies.** Users → top-level `paging.offset`; jobs/shifts → nested `data.paging.offset`. Check both.
8. **No `Retry-After` on 429.** Compute wait from `x-ratelimit-minute-reset` (UTC epoch s). API reported to return **200 with `x-ratelimit-*-remaining: 0`** instead of 429 — trust the remaining headers.

## Defaults (override only if user specifies)

`limit=100` (fewer round-trips, respects day budget), `offset=0`, `order=desc`, `userStatus=active`, date window ≤90 days.

## Operations

(D) DOCUMENTED, (I) INFERRED. Full catalog in 01a/02.

| Operation                      | Method | Path                                                       | Key params / notes                                                                                                  |
| ------------------------------ | ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Identity smoke test            | GET    | `/me`                                                      | — (D)                                                                                                               |
| List users                     | GET    | `/users/v1/users`                                          | limit, offset, sort, order, userStatus, userIds, fullNames, phoneNumbers, emailAddresses, createdAt, modifiedAt (D) |
| Get user                       | GET    | `/users/v1/users/{userId}`                                 | (I)                                                                                                                 |
| Create users (≤25)             | POST   | `/users/v1/users`                                          | body `users[]`; `?sendActivation` (D)                                                                               |
| Update users                   | PUT    | `/users/v1/users`                                          | body `users[]` (I)                                                                                                  |
| Archive users (bulk)           | DELETE | `/users/v1/users`                                          | body ids — destructive (D)                                                                                          |
| Delete user                    | DELETE | `/users/v1/users/{userId}`                                 | destructive (D)                                                                                                     |
| List time clocks               | GET    | `/time_clock/v1/time_clocks`                               | limit, offset (D)                                                                                                   |
| List time activities           | GET    | `/time_clock/v1/time_clocks/{id}/time_activities`          | startDate, endDate (≤92d), userIds, activityTypes (D)                                                               |
| Create time activities         | POST   | `/time_clock/v1/time_clocks/{id}/time_activities`          | body `timeActivities[]` (D)                                                                                         |
| Clock in / out                 | POST   | `/time_clock/v1/time_clocks/{id}/clock_in` \| `/clock_out` | body `{userId}` (D)                                                                                                 |
| Timesheet summary              | GET    | `/time_clock/v1/time_clocks/{id}/timesheet`                | date range (D)                                                                                                      |
| List schedulers                | GET    | `/scheduler/v1/schedulers`                                 | limit, offset (D)                                                                                                   |
| List shifts (V1/V2)            | GET    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`              | startTime, endTime (req), isPublished, isOpenShift, limit, offset (D)                                               |
| Create shifts (≤500)           | POST   | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`              | body `shifts[]` (D)                                                                                                 |
| Delete shifts (≤20)            | DELETE | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`              | body `shiftIds[]` — destructive (D)                                                                                 |
| User unavailability            | GET    | `/scheduler/{v1\|v2}/schedulers/user_unavailability`       | limit, offset (D)                                                                                                   |
| List jobs / sub-jobs           | GET    | `/jobs/v1/jobs`                                            | instanceIds, jobIds, jobCodes, includeDeleted, limit, offset (D)                                                    |
| List forms                     | GET    | `/forms/v1/forms`                                          | limit, offset — Enterprise (D)                                                                                      |
| List form submissions          | GET    | `/forms/v1/forms/{formId}/form_submissions`                | userIds, date window, limit, offset (D)                                                                             |
| Update submission (mgr fields) | PUT    | `/forms/v1/forms/{formId}/form_submissions/{id}`           | body `{managerFields}` only (D)                                                                                     |
| Create webhook                 | POST   | `/settings/v1/webhooks`                                    | body `{name,url,featureType,eventTypes,objectId,secretKey}` (D)                                                     |

## Pagination

offset/limit. Default page size **10** — always set `limit`. Max 500 (documented users+jobs; assume 500 elsewhere). No total count — last page = array shorter than `limit`. `paging` top-level for users, nested under `data` for jobs/shifts; check both. Result array keyed by resource name (`data.users`, `data.shifts`, `data.jobs`, `data.formSubmissions`).

```http
GET /users/v1/users?limit=500&offset=0     -> 500 (full page, continue)
GET /users/v1/users?limit=500&offset=500   -> 500 (full page, continue)
GET /users/v1/users?limit=500&offset=1000  -> 137 (< limit -> LAST PAGE)
```

## Webhooks / Events

Register via `POST /settings/v1/webhooks`. Body: `{name, url(HTTPS), featureType, eventTypes[], objectId, secretKey?, isDisabled?}`. `objectId` required for every featureType **except `users`**. `secretKey` optional (signature verification; header/algorithm **UNKNOWN**). `retryLimit` fixed at **3**. Webhook **payload body shape UNKNOWN** — verify against a live delivery.

| featureType       | Events                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_promoted` |
| `time_activity`   | `clock_in`, `clock_out`, `admin_add`, `admin_edit`, `admin_approved_add_request` |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created` |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`             |
| `tasks`           | `task_published`, `task_completed`                                               |

**Polling fallback:** poll any list endpoint with a `modifiedAt` epoch-second filter (e.g. `GET /users/v1/users?modifiedAt={epoch_s}`) every few minutes, respecting the per-account minute cap.

## Errors

Success envelope: `{requestId, data, paging?}`. Error shape uses a **`detail`** string field (e.g. `{"detail":"Too many requests"}`); full per-status bodies not published — confirm 401/403/422 via discovery.

| Status | Meaning          | Action                                                                                                                |
| ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| 400    | Bad request      | Fix params per `detail`                                                                                               |
| 401    | Unauthorized     | `X-API-KEY` missing/invalid/revoked — verify the stored key (re-mint in Settings); NOT retryable, no token to refresh |
| 403    | Forbidden        | Plan-gated (need Expert+, Forms=Enterprise)                                                                           |
| 404    | Not found        | Verify id (int vs UUID vs hex) + path module/version (V1 vs V2)                                                       |
| 422    | Validation error | Fix offending field(s) per `detail`                                                                                   |
| 429    | Rate limited     | Back off using `x-ratelimit-minute-reset`; no `Retry-After`                                                           |
| 5xx    | Server error     | Exponential backoff + jitter (≤3)                                                                                     |

**Rate-limit headers (six):** `x-ratelimit-minute-limit/-remaining/-reset` + `x-ratelimit-day-limit/-remaining/-reset` (reset = UTC epoch seconds).

## Examples

1. **Identity smoke test** — `GET /me` (with `X-API-KEY`) confirms the key:
   → `200 {"requestId":"…","data":{"object":{"name":"Acme Field Services","plan":"expert"}}}`

2. **List active users, newest first:**
   `GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=100&offset=0`
   → `{"requestId":"req_8f3c1a","data":{"users":[{"userId":7031021,"firstName":"Omer","lastName":"Vered","phoneNumber":"+9720548888888","email":"user@example.com","userType":"owner","isArchived":false,"createdAt":1712573537,"modifiedAt":1723640035,"smartGroupsIds":[2359154],"customFields":[{"customFieldId":6208755,"name":"Title","type":"str","value":"Solution Engineer"}]}]},"paging":{"offset":0}}`

3. **Time activities for a clock** (≤92-day window; `startDate`/`endDate` = `YYYY-MM-DD`, `start`/`end` = epoch s):
   `GET /time_clock/v1/time_clocks/12345/time_activities?startDate=2025-04-01&endDate=2025-04-30&userIds=9170357&activityTypes=shift`
   → `{"data":{"timeActivities":[{"userId":9170357,"shifts":[{"id":"shift-abc123","start":{"timestamp":1704110400,"timezone":"America/New_York"},"end":{"timestamp":1704139200,"timezone":"America/New_York"},"jobId":"job-123"}]}]}}`

4. **Shifts for a scheduler over a window** (V2; `startTime`/`endTime` epoch s **required**, overlapping shifts returned):
   `GET /scheduler/v2/schedulers/6833518/shifts?startTime=1736900000&endTime=1737500000&isPublished=true&limit=100`
   → `{"data":{"shifts":[{"id":"6784dacb3c07733b0a849f49","title":"Morning Shift","assignedUserIds":[9170357],"startTime":1736924400,"endTime":1736953200,"jobId":"d4ad7232-576f-2ff6-c57d-8240f1089b00","isPublished":true,"isOpenShift":false,"color":"#4B7AC5"}]}}`

5. **List jobs** (UUID ids, `paging` nested under `data`):
   `GET /jobs/v1/jobs?instanceIds=6833518&limit=100`
   → `{"requestId":"abc123-def456","data":{"paging":{"offset":100},"jobs":[{"jobId":"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d","title":"Delivery Driver","code":"DD-001","color":"#3968BB","isDeleted":false,"assign":{"type":"both","userIds":[7031021]},"instanceIds":[6833518]}]}}`
