---
api_name: 'Connecteam API (OAuth)'
api_slug: 'connecteam-oauth'
version: 'v1 (per-module path versioning)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Connecteam (OAuth) -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the Connecteam (OAuth) integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.
>
> **Shared API:** This is the **same REST API** as the `connecteam-api` (API-key) connector. Domain model, query/filter, mutation, pagination, and error behaviour are **identical** — only the auth section below differs. Keep 01a/01b/01c consistent across both connectors.

## Context

- **API:** Connecteam REST API, per-module `v1` (`/users/v1`, `/time-clock/v1`, `/scheduler/v1`, `/forms/v1`, `/settings/v1`) [DOCUMENTED]
- **Base URL:** `https://api.connecteam.com` (global). **AU data residency:** `https://api-au.connecteam.com` [DOCUMENTED]
- **Auth:** OAuth 2.0 Bearer token. Calls go through Numa's `connect_request` proxy, which injects the token from the user's vault. [DOCUMENTED — registry `authType: oauth2`]
- **Integration path:** Direct API via `connect_request` (not a Files connector — records, not browsable files)
- **Rate limits:** Per **account** (shared by all API clients): Enterprise 200/min + 20k/day; Expert 100/min; SBP 5/min. [DOCUMENTED]
- **Plan gating:** Public API is **Enterprise-plan only**. [DOCUMENTED]

## Auth Structure

```
Authorization: Bearer {access_token}
Accept: application/json
Content-Type: application/json   (on POST/PUT bodies)
```

**⚠️ OAuth flow conflict — READ THIS.** The connector registry stores redirect-style endpoints
(`app.connecteam.com/oauth/authorize` + `/oauth/token`, scopes `forms.read attachments.write`),
but Connecteam's **official OAuth 2.0 docs document `client_credentials` only** — no consent/redirect step:

- **Token URL (official):** `POST https://api.connecteam.com/oauth/v1/token` [DOCUMENTED]
- **Client auth:** HTTP **Basic** (Client ID = username, Client Secret = password) [DOCUMENTED]
- **Body:** `grant_type=client_credentials` (form-urlencoded); optional `scope=...` [DOCUMENTED]
- **Response:** `{ "access_token", "token_type": "Bearer", "expires_in": 86400, "scope": "..." }` [DOCUMENTED]

**Token lifecycle:**

- Access token lifetime: **86400 s (24 h)**. [DOCUMENTED]
- **No refresh token** — re-request from the token endpoint when it expires (on 401). [DOCUMENTED]
- Scopes are **immutable after app creation** (must create a new app to change them). Scope format is `feature.permission`, e.g. `users.read`, `schedule.write`. [DOCUMENTED]

> The agent does not perform the token exchange — `connect_request` handles auth. The flow is documented here only so you understand expiry (401 → token refreshed transparently) and the scope model.

## Capabilities

### CAN

1. List/search **users** by status, name, phone, email (filters + offset/limit pagination). [DOCUMENTED]
2. Read **time clocks**, **time activities** (shift/break/timeoff) and **timesheet** summaries (≤ 92-day window). [DOCUMENTED]
3. List **schedulers** and query **shifts** by date range; read **user unavailability**. [DOCUMENTED]
4. List **forms** and read/filter **form submissions** (by user / date). [DOCUMENTED]
5. Read **jobs / sub-jobs** for categorisation context. [DOCUMENTED — module; paths INFERRED]
6. (If write scopes granted) create users, create/clock-in/clock-out time activities, create/update shifts, update form manager fields — **always with explicit user confirmation**. [DOCUMENTED]

### CANNOT

1. Delete users, shifts, or unavailability without explicit confirmation (deletes are destructive). [policy]
2. Full-text search — only whitelisted exact-match field filters per endpoint. [INFERRED]
3. Select/sparse fields or include related records — use the child endpoints instead. [INFERRED]
4. Exceed batch caps (users ≤ 25 / shift-create ≤ 500 / shift-delete ≤ 20) or the 92-day activity window. [DOCUMENTED]
5. Cross data-residency boundaries — AU tenants MUST target `api-au.connecteam.com`. [DOCUMENTED]

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Timestamps are Unix epoch SECONDS**, not milliseconds and not ISO-8601. `start`, `end`, `startTime`, `endTime`, `createdAt`, `modifiedAt`, and all `*Timestamp` filters use seconds. This is the #1 integration bug. [DOCUMENTED]
2. **Rate limits are per ACCOUNT, shared across every API client** — not per token. On non-Enterprise plans (SBP = 5/min) you throttle almost instantly. Cache list reads aggressively. [DOCUMENTED]
3. **92-day cap on time-activity queries.** A wider `startTime`/`endTime` window is rejected. Split into ≤ 90-day chunks. [DOCUMENTED]
4. **Module-versioned paths.** The base has no global `/v1` — each module carries its own: `/users/v1/...`, `/time-clock/v1/...`. Don't write `/v1/users`. [DOCUMENTED]
5. **No total count.** Detect the last page with the "fewer-than-limit" heuristic, not a total. [DOCUMENTED]
6. **No refresh token.** A 401 means the 24h token expired — `connect_request` re-fetches; just retry the call once. [DOCUMENTED]
7. **AU tenants use a different host.** If calls 401/404 unexpectedly for an AU customer, switch to `api-au.connecteam.com`. [DOCUMENTED]
8. **Phone-led identity.** Users are keyed on E.164 phone numbers; creating a user typically requires a valid `phoneNumber`. [INFERRED]

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter   | Default   | Reason                                          |
| ----------- | --------- | ----------------------------------------------- |
| limit       | 100       | Fewer round-trips, well under per-endpoint caps |
| offset      | 0         | Start at first page                             |
| order       | `desc`    | Most-recent-first matches chat expectations     |
| userStatus  | `active`  | Default; pass `all`/`archived` only when asked  |
| date window | ≤ 90 days | Stay safely inside the 92-day time-activity cap |

## Working Examples

### Example 1: List active users, newest first

```http
GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=100&offset=0
Host: api.connecteam.com
Authorization: Bearer {access_token}
Accept: application/json
```

```json
{
  "requestId": "req_8f3c1a",
  "data": {
    "users": [
      {
        "userId": 4815162,
        "firstName": "Jane",
        "lastName": "Doe",
        "phoneNumber": "+14155550101",
        "email": "jane@acme.com",
        "userType": "user",
        "userStatus": "active",
        "createdAt": 1716950400,
        "modifiedAt": 1716950400
      }
    ]
  },
  "paging": { "limit": 100, "offset": 0 }
}
```

> Envelope keys `requestId`/`paging` are [INFERRED] — only `data.users` is confirmed by the pagination guide.

### Example 2: Time activities for a clock (within the 92-day window)

```http
GET /time-clock/v1/time-clocks/12345/time-activities?startTime=1714521600&endTime=1717113600&limit=100
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

```json
{
  "data": {
    "timeActivities": [
      { "userId": 4815162, "type": "shift", "start": 1716969600, "end": 1716998400 },
      { "userId": 4815162, "type": "break", "start": 1716980400, "end": 1716982200 }
    ]
  }
}
```

> `startTime`/`endTime` filter slugs are [INFERRED]; the 92-day cap and `type` enum are [DOCUMENTED].

### Example 3: Shifts for a scheduler over a pay period

```http
GET /scheduler/v1/schedulers/321/shifts?startTime=1716163200&endTime=1717372800&limit=100
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

```json
{
  "data": {
    "shifts": [
      {
        "shiftId": 987654,
        "schedulerId": 321,
        "type": "regular",
        "assignees": [4815162],
        "startTime": 1716969600,
        "endTime": 1716998400,
        "status": "published"
      }
    ]
  }
}
```

### Example 4: Form submissions for specific users in a date window

```http
GET /forms/v1/forms/555/form-submissions?userIds=4815162&submittingStartTimestamp=1714521600&submittingEndTime=1717200000&limit=100
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

```json
{
  "data": {
    "formSubmissions": [
      {
        "submissionId": 90001,
        "formId": 555,
        "userId": 4815162,
        "submittedAt": 1716000000,
        "managerFields": { "status": "approved" }
      }
    ]
  }
}
```

> Form-submission `limit` max is **100** (not 500). [DOCUMENTED]

## Proxy API Operations

> Quick reference. Full catalog in 01a. Confidence per row in parentheses.

| Operation              | Method | Path                                                    | Key Parameters                                                                               |
| ---------------------- | ------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Identity smoke test    | GET    | `/me`                                                   | — (D)                                                                                        |
| List users             | GET    | `/users/v1/users`                                       | limit, offset, sort, order, userStatus, userIds, fullNames, phoneNumbers, emailAddresses (D) |
| Get user               | GET    | `/users/v1/users/{userId}`                              | — (I)                                                                                        |
| Create users (≤25)     | POST   | `/users/v1/users`                                       | body `users[]`; `?sendActivation` (D)                                                        |
| Update users           | PUT    | `/users/v1/users`                                       | body `users[]` (I)                                                                           |
| List time clocks       | GET    | `/time-clock/v1/time-clocks`                            | limit, offset (D)                                                                            |
| List time activities   | GET    | `/time-clock/v1/time-clocks/{id}/time-activities`       | startTime, endTime (≤92d), userId (D)                                                        |
| Create time activities | POST   | `/time-clock/v1/time-clocks/{id}/time-activities`       | body (D)                                                                                     |
| Clock in / out         | POST   | `/time-clock/v1/time-clocks/{id}/clock-in` `/clock-out` | body (D)                                                                                     |
| Timesheet summary      | GET    | `/time-clock/v1/time-clocks/{id}/timesheet`             | date range (D)                                                                               |
| List schedulers        | GET    | `/scheduler/v1/schedulers`                              | limit, offset (D)                                                                            |
| List shifts            | GET    | `/scheduler/v1/schedulers/{sid}/shifts`                 | startTime, endTime, limit, offset (D)                                                        |
| Create shifts (≤500)   | POST   | `/scheduler/v1/schedulers/{sid}/shifts`                 | body `shifts[]` (D)                                                                          |
| Delete shifts (≤20)    | DELETE | `/scheduler/v1/schedulers/{sid}/shifts`                 | body ids (D)                                                                                 |
| User unavailability    | GET    | `/scheduler/v1/schedulers/user-unavailability`          | limit, offset (D)                                                                            |
| List forms             | GET    | `/forms/v1/forms`                                       | limit, offset (D)                                                                            |
| List form submissions  | GET    | `/forms/v1/forms/{formId}/form-submissions`             | userIds, submittingStartTimestamp, submittingEndTime, limit (max 100), offset (D)            |
| List jobs / sub-jobs   | GET    | `/jobs/v1/jobs`                                         | limit, offset (I)                                                                            |
| Create webhook         | POST   | `/settings/v1/webhooks`                                 | body `{name,url,feature,events,secretKey,retryLimit}` (D)                                    |

_(D) = DOCUMENTED, (I) = INFERRED._

## Pagination

- **Type:** offset / limit [DOCUMENTED]
- **Default page size:** 10 [DOCUMENTED]
- **Max page size:** endpoint-specific — users `500`, form-submissions `100`; no global max published [DOCUMENTED]
- **How to paginate:**

```http
GET /users/v1/users?limit=500&offset=0     -> 500 items (full page, continue)
GET /users/v1/users?limit=500&offset=500   -> 500 items (full page, continue)
GET /users/v1/users?limit=500&offset=1000  -> 137 items (< limit -> LAST PAGE)
```

- **Last page detection:** the response returns **fewer items than `limit`**. No total count is returned. [DOCUMENTED]

## Webhooks / Events

**Supported (register via `POST /settings/v1/webhooks`):**

| Feature           | Example events                                                                   |
| ----------------- | -------------------------------------------------------------------------------- |
| `users`           | `user_created`, `user_updated`, `user_deleted`, `user_archived`, `user_restored` |
| `time_activity`   | `clock_in`, `clock_out` (+ approval variants)                                    |
| `shift_scheduler` | `shift_created`, `shift_updated`, `shift_deleted`                                |
| `forms`           | `form_submission`, `form_submission_edited`, `manager_field_updated`             |
| `tasks`           | `task_published`, `task_completed`                                               |

**Setup:** body `{ name, url (HTTPS), feature, events[], secretKey, retryLimit }`. `secretKey` is for signature verification (algorithm not documented); `retryLimit` fixed at 3. Webhook **payload body shape is UNKNOWN** — discovery needed. [DOCUMENTED — catalog; UNKNOWN — payload]

**Polling fallback:** any list endpoint with a `modifiedAt` epoch-second filter; poll every few minutes (respect the per-account minute cap). [DOCUMENTED]

## Error Handling

**Standard error format** [INFERRED — FastAPI/ReadMe-style; confirm against a live 422]:

```json
{
  "requestId": "req_8f3c1a",
  "statusCode": 422,
  "message": "Validation error",
  "detail": [{ "loc": ["body", "users", 0, "phoneNumber"], "msg": "field required", "type": "value_error.missing" }]
}
```

**Recovery by status:**

| Status | Meaning          | Action                                                                     |
| ------ | ---------------- | -------------------------------------------------------------------------- |
| 400    | Bad request      | Fix request parameters                                                     |
| 401    | Unauthorized     | Token expired (24h, no refresh) — retry once; `connect_request` re-fetches |
| 403    | Forbidden        | Missing scope, or account is below the Enterprise plan                     |
| 404    | Not found        | Verify id / scheduler / formId; check AU host for AU tenants               |
| 422    | Validation error | Inspect `detail[]` field errors                                            |
| 429    | Rate limited     | Back off using `x-ratelimit-minute-reset`; no `Retry-After`                |
| 5xx    | Server error     | Retry with exponential backoff                                             |

**Rate-limit headers:** `x-ratelimit-minute-limit/-remaining/-reset`, `x-ratelimit-day-limit/-remaining/-reset` (reset = UTC epoch seconds). [DOCUMENTED]

## Known Limitations

1. **OAuth flow conflict (build blocker).** Registry endpoints disagree with official `client_credentials` docs — must be reconciled before connector build. [DOCUMENTED]
2. **No live-tested examples.** Response envelopes, error bodies, and webhook payloads are [INFERRED]/[UNKNOWN].
3. **No full-text search, no field selection, no `include` — and no idempotency keys.** POST clock-in/out and create-users are non-idempotent; guard against duplicate calls. [DOCUMENTED/INFERRED]
4. **Enterprise-plan gating** restricts who can use the API at all. [DOCUMENTED]

---

_Generated from investigation questionnaire. See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entity catalog, relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination examples_
- _01c-mutation-patterns.md — Create, update, delete patterns_
- _01d-event-and-error-handling.md — Events, webhooks, error recovery_
