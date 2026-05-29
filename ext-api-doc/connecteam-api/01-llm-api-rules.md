---
api_name: 'Connecteam (API Key)'
api_slug: 'connecteam-api'
version: 'per-module path versioning (v1; scheduler shifts also v2)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Connecteam (API Key) -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the Connecteam (API Key) integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.
>
> **Shared API:** This is the **same REST API** as the `connecteam-oauth` connector. Domain model,
> query/filter, mutation, pagination, and error behaviour are **identical** — the **only** substantive
> difference is auth (this connector sends a static `X-API-KEY` header; the OAuth connector mints a
> 24h bearer token). Keep 01a/01b/01c consistent across both connectors.

## Context

- **API:** Connecteam REST API. Per-module path versioning: `/users/v1`, `/time_clock/v1`, `/scheduler/v1` (+ `/scheduler/v2`), `/jobs/v1`, `/forms/v1`, `/settings/v1`. [DOCUMENTED]
- **Base URL:** `https://api.connecteam.com` (fixed — there is **no** instance/region field in the registry). [DOCUMENTED — matches `connectorRegistry.ts`]
- **Auth:** API key in the `X-API-KEY` header. Calls go through Numa's `connect_request` proxy, which injects the stored `api_token` as `X-API-KEY` and forwards. [DOCUMENTED — registry `authType: api-key`, single field `api_token`]
- **Integration path:** Direct API via `connect_request` (not a Files connector — structured workforce records, not browsable files).
- **Rate limits:** Per **account** (shared by all keys/clients): SBP 5/min · 100/day; Expert 100/min · 10k/day; Enterprise 200/min · 20k/day. Six `x-ratelimit-*` headers. [DOCUMENTED]
- **Plan gating:** API requires **Expert plan or higher**; **Forms API is Enterprise-only**. [DOCUMENTED]

## Auth Structure

API-key authentication via an HTTP request header.

```
X-API-KEY: {api_token}
Accept: application/json
Content-Type: application/json   (on POST/PUT bodies)
```

**Token lifecycle:**

- The API key is a **static, account-level secret that does NOT expire**. There is no token exchange, no refresh, and no `expires_in`. This is the whole simplification vs the OAuth connector. [DOCUMENTED]
- Keys are minted by an **account owner** in the Connecteam web app: **Settings → API Keys → Add API key**. Owner-only; account must be Expert+. [DOCUMENTED]
- Rotation is manual (create new key, delete old in Settings; no programmatic rotation). `connect_request` attaches the header — the agent never sees the raw key. Never log or echo it. [INFERRED]

> **Contrast with `connecteam-oauth`:** that connector sends `Authorization: Bearer {token}` from a 24h `client_credentials` token; this one sends `X-API-KEY`. Do **not** send `Authorization: Bearer …` here.

## Capabilities

### CAN

1. List/search **users** by status, name, phone, email (filters + offset/limit pagination). [DOCUMENTED]
2. Read **time clocks**, **time activities** (shift/break/timeoff) and **timesheet** summaries (≤ 92-day window). [DOCUMENTED]
3. List **schedulers** (V1 + V2) and query **shifts** by time window; read **user unavailability**. [DOCUMENTED]
4. List **forms** and read/filter **form submissions** by user/date (Enterprise plan only). [DOCUMENTED]
5. Read/manage **jobs / sub-jobs** for categorisation context (jobs use UUID ids). [DOCUMENTED]
6. (Destructive/write ops, always with explicit user confirmation) create users, create/clock-in/clock-out time activities, create/update/delete shifts, update form manager fields, manage webhooks. [DOCUMENTED]

### CANNOT

1. Delete users, shifts, or unavailability without explicit confirmation (deletes are destructive). [policy]
2. Full-text search — only whitelisted exact-match field filters per endpoint. [INFERRED]
3. Select/sparse fields or include related records — fetch child endpoints separately. [INFERRED]
4. Exceed batch caps (users ≤ 25 · shift-create ≤ 500 · shift-delete ≤ 20) or the 92-day activity window. [DOCUMENTED]
5. Use features above the account's plan — Forms is **Enterprise-only**; SBP is throttled to 5 req/min. [DOCUMENTED]

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Timestamps are Unix epoch SECONDS**, not milliseconds and not ISO-8601. `start`, `end`, `startTime`, `endTime`, `createdAt`, `modifiedAt` and all `*Timestamp` filters use seconds. This is the #1 integration bug. (Some time-activity date filters use `YYYY-MM-DD` strings.) [DOCUMENTED]
2. **Mixed ID types — never coerce.** Users/clocks/schedulers/custom-fields are **integers**; jobs are **UUID strings**; scheduler shifts are **24-char hex strings**. Don't assume all ids are numeric. [DOCUMENTED]
3. **Module-versioned, underscore paths.** No global `/v1`. Each module carries its own: `/users/v1/...`, `/time_clock/v1/...`, `/scheduler/v2/...`. Paths use **underscores** (`time_clock`, `form_submissions`), not hyphens, and not `/v1/users`. [DOCUMENTED]
4. **Rate limits are per ACCOUNT, shared across every key/client** — not per key. On SBP (5/min) you throttle almost instantly. Cache list reads; throttle proactively on `x-ratelimit-*-remaining`. [DOCUMENTED]
5. **92-day cap on time-activity queries.** A wider `startDate`/`endDate` window is rejected. Split into ≤ 90-day chunks. [DOCUMENTED]
6. **No total count.** Detect the last page with the "fewer-than-limit" heuristic, not a total. [DOCUMENTED]
7. **`paging` location is inconsistent.** Users put it at the **top level**; jobs/shifts nest it under `data.paging`. Parsers must check both. [DOCUMENTED]
8. **No `Retry-After` on 429.** Compute the wait from `x-ratelimit-minute-reset` (UTC epoch seconds). The API has also been reported to return 200 with `x-ratelimit-*-remaining: 0` instead of 429 — trust the remaining headers. [DOCUMENTED]

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter   | Default   | Reason                                                           |
| ----------- | --------- | ---------------------------------------------------------------- |
| limit       | 100       | Fewer round-trips; well under endpoint caps; respects day budget |
| offset      | 0         | Start of result set                                              |
| order       | `desc`    | Most-recent-first matches chat expectations                      |
| userStatus  | `active`  | Exclude archived employees unless asked                          |
| date window | ≤ 90 days | Stay safely inside the 92-day time-activity cap                  |

## Working Examples

### Example 1: Identity smoke test (`/me`)

```http
GET /me HTTP/1.1
Host: api.connecteam.com
Accept: application/json
X-API-KEY: {api_token}
```

Returns `200` with `{ "requestId": "…", "data": { "object": { "name": "Acme Field Services", "plan": "expert" } } }` — confirms the key is valid. The `/me` path is the only unversioned/unprefixed one. [DOCUMENTED — shape illustrative]

### Example 2: List active users, newest first

```http
GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=100&offset=0
Host: api.connecteam.com
X-API-KEY: {api_token}
Accept: application/json
```

```json
{
  "requestId": "req_8f3c1a",
  "data": {
    "users": [
      {
        "userId": 7031021,
        "firstName": "Omer",
        "lastName": "Vered",
        "phoneNumber": "+9720548888888",
        "email": "user@example.com",
        "userType": "owner",
        "isArchived": false,
        "createdAt": 1712573537,
        "modifiedAt": 1723640035,
        "smartGroupsIds": [2359154],
        "customFields": [{ "customFieldId": 6208755, "name": "Title", "type": "str", "value": "Solution Engineer" }]
      }
    ]
  },
  "paging": { "offset": 0 }
}
```

### Example 3: Time activities for a clock (within the 92-day window)

```http
GET /time_clock/v1/time_clocks/12345/time_activities?startDate=2025-04-01&endDate=2025-04-30&userIds=9170357&activityTypes=shift
Host: api.connecteam.com
X-API-KEY: {api_token}
```

```json
{
  "data": {
    "timeActivities": [
      {
        "userId": 9170357,
        "shifts": [
          {
            "id": "shift-abc123",
            "start": { "timestamp": 1704110400, "timezone": "America/New_York" },
            "end": { "timestamp": 1704139200, "timezone": "America/New_York" },
            "jobId": "job-123"
          }
        ]
      }
    ]
  }
}
```

> `startDate`/`endDate` are `YYYY-MM-DD`; the range must be ≤ 92 days. `start`/`end` timestamps are epoch seconds.

### Example 4: Shifts for a scheduler over a window (V2)

```http
GET /scheduler/v2/schedulers/6833518/shifts?startTime=1736900000&endTime=1737500000&isPublished=true&limit=100
Host: api.connecteam.com
X-API-KEY: {api_token}
```

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

> `startTime`/`endTime` (epoch seconds) are **required**; shifts that **overlap** the window are returned.

### Example 5: List jobs (UUID ids, `paging` nested under `data`)

```http
GET /jobs/v1/jobs?instanceIds=6833518&limit=100
Host: api.connecteam.com
X-API-KEY: {api_token}
```

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
        "isDeleted": false,
        "assign": { "type": "both", "userIds": [7031021] },
        "instanceIds": [6833518]
      }
    ]
  }
}
```

## Proxy API Operations

> Quick reference. Full catalog in 01a. Confidence per row: (D) DOCUMENTED, (I) INFERRED.

| Operation              | Method | Path                                                     | Key Parameters                                                                                                      |
| ---------------------- | ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Identity smoke test    | GET    | `/me`                                                    | — (D)                                                                                                               |
| List users             | GET    | `/users/v1/users`                                        | limit, offset, sort, order, userStatus, userIds, fullNames, phoneNumbers, emailAddresses, createdAt, modifiedAt (D) |
| Get user               | GET    | `/users/v1/users/{userId}`                               | — (I)                                                                                                               |
| Create users (≤25)     | POST   | `/users/v1/users`                                        | body `users[]`; `?sendActivation` (D)                                                                               |
| Update users           | PUT    | `/users/v1/users`                                        | body `users[]` (I)                                                                                                  |
| Archive users          | DELETE | `/users/v1/users`                                        | body ids (D)                                                                                                        |
| List time clocks       | GET    | `/time_clock/v1/time_clocks`                             | limit, offset (D)                                                                                                   |
| List time activities   | GET    | `/time_clock/v1/time_clocks/{id}/time_activities`        | startDate, endDate (≤92d), userIds, activityTypes (D)                                                               |
| Create time activities | POST   | `/time_clock/v1/time_clocks/{id}/time_activities`        | body `timeActivities[]` (D)                                                                                         |
| Clock in / out         | POST   | `/time_clock/v1/time_clocks/{id}/clock_in` / `clock_out` | body (D)                                                                                                            |
| Timesheet summary      | GET    | `/time_clock/v1/time_clocks/{id}/timesheet`              | date range (D)                                                                                                      |
| List schedulers        | GET    | `/scheduler/v1/schedulers`                               | limit, offset (D)                                                                                                   |
| List shifts (V1/V2)    | GET    | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`            | startTime, endTime, isPublished, isOpenShift, limit, offset (D)                                                     |
| Create shifts (≤500)   | POST   | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`            | body `shifts[]` (D)                                                                                                 |
| Delete shifts (≤20)    | DELETE | `/scheduler/{v1\|v2}/schedulers/{sid}/shifts`            | body ids (D)                                                                                                        |
| User unavailability    | GET    | `/scheduler/{v1\|v2}/schedulers/user_unavailability`     | limit, offset (D)                                                                                                   |
| List jobs / sub-jobs   | GET    | `/jobs/v1/jobs`                                          | instanceIds, jobIds, jobCodes, includeDeleted, limit, offset (D)                                                    |
| List forms             | GET    | `/forms/v1/forms`                                        | limit, offset (D)                                                                                                   |
| List form submissions  | GET    | `/forms/v1/forms/{formId}/form_submissions`              | userIds, date window, limit, offset (D)                                                                             |
| Create webhook         | POST   | `/settings/v1/webhooks`                                  | body `{name,url,featureType,eventTypes,objectId,secretKey}` (D)                                                     |

## Pagination

- **Type:** offset / limit [DOCUMENTED]
- **Default page size:** 10 [DOCUMENTED]
- **Max page size:** 500 (documented on users + jobs; assume 500 elsewhere). [DOCUMENTED / INFERRED]
- **How to paginate:**

```http
GET /users/v1/users?limit=500&offset=0     -> 500 items (full page, continue)
GET /users/v1/users?limit=500&offset=500   -> 500 items (full page, continue)
GET /users/v1/users?limit=500&offset=1000  -> 137 items (< limit -> LAST PAGE)
```

- **Last page detection:** the array returns **fewer items than `limit`**. There is no total count. [DOCUMENTED]
- **`paging` location varies:** top-level (`paging.offset`) for users; nested (`data.paging.offset`) for jobs/shifts. [DOCUMENTED]

## Webhooks / Events

**Supported (register via `POST /settings/v1/webhooks`):**

| featureType       | Example events                                                                   |
| ----------------- | -------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_promoted` |
| `time_activity`   | `clock_in`, `clock_out`, `admin_add`, `admin_edit`, `admin_approved_add_request` |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`, `availability_status_created` |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`             |
| `tasks`           | `task_published`, `task_completed`                                               |

**Setup:** body `{ name, url (HTTPS), featureType, eventTypes[], objectId, secretKey?, isDisabled? }`.
`objectId` is required for every featureType **except `users`**. `secretKey` is optional (signature
verification; header/algorithm **not documented**). `retryLimit` is fixed at **3**. Webhook **payload body
shape is UNKNOWN** — discovery needed. [DOCUMENTED — catalog; UNKNOWN — payload/signature]

**Polling fallback:** poll any list endpoint with a `modifiedAt` epoch-second filter (e.g.
`GET /users/v1/users?modifiedAt={epoch_s}`) every few minutes, respecting the per-account minute cap. [DOCUMENTED]

## Error Handling

**Standard error format** — the success envelope is `{ requestId, data, paging? }`; the documented error
shape uses a **`detail`** field (a comprehensive per-status table is not published — confirm 401/403/422
bodies via discovery):

```json
{ "detail": "Too many requests" }
```

**Recovery by status:**

| Status | Meaning          | Action                                                                |
| ------ | ---------------- | --------------------------------------------------------------------- |
| 400    | Bad request      | Fix request parameters per `detail`                                   |
| 401    | Unauthorized     | Invalid/revoked `X-API-KEY` — verify the key; not retryable           |
| 403    | Forbidden        | Plan-gated (need Expert+/Enterprise) or feature not on plan (Forms)   |
| 404    | Not found        | Verify the id (int vs UUID vs hex string) and the path module/version |
| 422    | Validation error | Fix the offending field(s) per `detail`                               |
| 429    | Rate limited     | Back off using `x-ratelimit-minute-reset`; no `Retry-After`           |
| 5xx    | Server error     | Retry with exponential backoff + jitter                               |

**Rate-limit headers:** `x-ratelimit-minute-limit/-remaining/-reset` and `x-ratelimit-day-limit/-remaining/-reset` (reset = UTC epoch seconds). [DOCUMENTED]

> **Auth note:** a bad/revoked `X-API-KEY` returns 401/403 (exact body unconfirmed). This is the **one**
> error surface whose cause differs from the OAuth connector (which would fail at the token-mint step).

## Known Limitations

1. **No live-tested examples.** Response envelopes, error bodies (401/403/422), and webhook payloads are [DOCUMENTED-shape]/[INFERRED]/[UNKNOWN].
2. **No full-text search, field selection, `include`, or idempotency keys.** Clock-in/out and create-users are non-idempotent — guard against double-submit and verify with a GET. [DOCUMENTED/INFERRED]
3. **Plan gating + shared per-account rate limits:** API needs Expert+; Forms is Enterprise-only; SBP is 5 req/min; the minute/day budget is shared across every key and integration. [DOCUMENTED]

---

_Generated from investigation questionnaire. See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entity catalog, relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination examples_
- _01c-mutation-patterns.md — Create, update, delete patterns_
- _01d-event-and-error-handling.md — Events, webhooks, error recovery_
