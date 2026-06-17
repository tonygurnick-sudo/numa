---
api_name: Connecteam (API Key)
api_slug: connecteam-api
base_url: https://api.connecteam.com
call_surface: HTTP via `numa integrations request`
auth: X-API-KEY header
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01d=events+errors
shared_api: write behaviour identical to connecteam-oauth — only auth header + scope model differ; keep in sync
permissions: single account-level key = FULL account access, NO scope model. Only gating is plan tier (Expert+; Forms=Enterprise). Unlike OAuth, no immutable feature.permission scopes can 403 a write — guard destructive ops with user confirmation, not scopes.
confidence: [DOCUMENTED] from vendor docs unless tagged [INFERRED]/[UNKNOWN]; NO live call made
---

# Connecteam (API Key) — Mutation Patterns Reference

Write patterns: create, update, delete, clock-in/out, state transitions, batch, async auto-assign. Companion to `01-llm-api-rules.md`.

## Write Capabilities

| Operation              | Method   | Notes                                                  |
| ---------------------- | -------- | ------------------------------------------------------ |
| Create users           | POST     | Batch ≤25 per request                                  |
| Update users           | PUT      | Batch (≤25 cap assumed) [INFERRED]                     |
| Promote to admin       | POST     | `/users/v1/admins`                                     |
| Archive users          | DELETE   | `DELETE /users/v1/users` (bulk archive) — destructive  |
| Delete user            | DELETE   | `DELETE /users/v1/users/{userId}` — destructive        |
| Create time activities | POST     | shift / manual_break / time_off records                |
| Update time activities | PUT      |                                                        |
| Clock in / out         | POST     | Real-time; **non-idempotent**                          |
| Create shifts          | POST     | Batch ≤500 per request                                 |
| Update shifts          | PUT      | Bulk; cap [UNKNOWN]                                    |
| Delete shifts (bulk)   | DELETE   | Batch ≤20 per request — destructive                    |
| Delete shift (single)  | DELETE   | `/shifts/{shiftId}` — destructive                      |
| Add unavailability     | POST     |                                                        |
| Remove unavailability  | DELETE   | Destructive                                            |
| Create / update jobs   | POST/PUT | UUID ids; soft-delete via DELETE/`isDeleted`           |
| Update submission      | PUT      | **Manager fields only**; answers immutable             |
| Auto-assign shifts     | POST     | Async → poll `requestId`                               |
| Upload attachment      | POST/PUT | Two-step pre-signed flow                               |
| Create webhook         | POST     | `/settings/v1/webhooks`                                |
| Idempotency keys       | —        | None documented — guard non-idempotent POSTs [UNKNOWN] |

## Patterns

All requests send `X-API-KEY: {api_token}` + `Content-Type: application/json` (bodies).

### Pattern 1: Create users (batch ≤25)

```http
POST /users/v1/users?sendActivation=false
{"users":[{"firstName":"Jane","lastName":"Doe","phoneNumber":"+14155550101","email":"jane@acme.com"}]}
```

- **Max 25 users per request.** Split larger batches.
- `phoneNumber` (E.164) is the login identity, generally required [INFERRED].
- `sendActivation` (boolean, default `false`) controls whether the invite SMS/email is sent.
- Non-idempotent — re-running creates duplicates.
- Responses: `200 Successful Response`, `422 Validation Error`.

### Pattern 2: Update users (PUT)

```http
PUT /users/v1/users
{"users":[{"userId":7031021,"email":"jane.doe@acme.com"}]}
```

[INFERRED — body shape deduced from create endpoint; `userId` keys each item. Verify live.]

### Pattern 3: Create time activities (shift / manual_break / time_off)

```http
POST /time_clock/v1/time_clocks/12345/time_activities
{"timeActivities":[{"userId":9170357,"shifts":[{"start":{"timestamp":1704110400,"timezone":"America/New_York"},"end":{"timestamp":1704139200,"timezone":"America/New_York"},"jobId":"9fdebf1f-0c69-4914-89d2-8f86c3e5f47d","employeeNote":"Imported from external system"}],"manualbreaks":[]}]}
```

- `start.timestamp`/`end.timestamp` are **Unix epoch seconds**, inside a `{timestamp, timezone}` object.
- Omit `end` to create an open (in-progress) activity [INFERRED].
- `jobId` is a **UUID string**.

### Pattern 4: Real-time clock-in / clock-out

```http
POST /time_clock/v1/time_clocks/12345/clock_in
{"userId":9170357}
```

```http
POST /time_clock/v1/time_clocks/12345/clock_out
{"userId":9170357}
```

> **Non-idempotent and side-effecting.** Clock-in twice can create a duplicate open activity; clock-out on an already-closed activity may error. Confirm intent, verify state with a GET.

### Pattern 5: Create shifts (batch ≤500, V2)

```http
POST /scheduler/v2/schedulers/6833518/shifts
{"shifts":[{"title":"Morning Shift","assignedUserIds":[9170357],"startTime":1736924400,"endTime":1736953200,"jobId":"d4ad7232-576f-2ff6-c57d-8240f1089b00","isPublished":true}]}
```

- **Max 500 shifts per request.**
- `startTime`/`endTime` epoch seconds; `assignedUserIds` integers; `jobId` a UUID.
- **Cannot** create data layers, shift tasks, repeating, or group shifts via the API.
- Default to **V2**; V1 (`/scheduler/v1/...`) remains available.

### Pattern 6: Delete shifts (bulk ≤20, or single)

```http
DELETE /scheduler/v2/schedulers/6833518/shifts
{"shiftIds":["6784dacb3c07733b0a849f49","6784dacb3c07733b0a849f4a"]}
```

```http
DELETE /scheduler/v2/schedulers/6833518/shifts/6784dacb3c07733b0a849f49
```

> **Destructive — confirm with the user first.** Bulk delete capped at **20** ids. Shift ids are hex strings. Body shape (`shiftIds`) [INFERRED]; ≤20 cap [DOCUMENTED].

### Pattern 7: Update form-submission manager fields (the only writable part)

```http
PUT /forms/v1/forms/555/form_submissions/90001
{"managerFields":{"status":"approved","note":"Reviewed by Pat","date":1717113600}}
```

> Answer entries are **immutable** — only `person`/`status`/`note`/`date` manager fields can be set. Forms API **Enterprise-only**. Path/route [INFERRED]; manager-field-only constraint [DOCUMENTED].

### Pattern 8: Async auto-assign shifts (start + poll)

```http
POST /scheduler/v2/schedulers/6833518/shifts_auto_assign
{"shiftIds":["6784dacb3c07733b0a849f49"]}
```

Returns a `requestId`; poll until complete:

```http
GET /scheduler/v2/schedulers/6833518/shifts_auto_assign/{requestId}
```

→ `{"requestId":"asg_123","status":"pending"}`
[DOCUMENTED async pattern; request body shape [INFERRED]. Poll on a backoff; respect rate limits.]

### Pattern 9: Create a webhook subscription

```http
POST /settings/v1/webhooks
{"name":"Numa user sync","url":"https://example.com/hooks/connecteam","featureType":"users","eventTypes":["user_created","user_updated","user_archived"],"secretKey":"whsec_…","isDisabled":false}
```

> `objectId` required for every `featureType` **except `users`**. `url` must be HTTPS. `secretKey` optional (signature verification).

## Field Validation Rules

| Entity        | Field                  | Rule                                      | Source       |
| ------------- | ---------------------- | ----------------------------------------- | ------------ |
| User          | firstName/lastName     | Required on create                        | [INFERRED]   |
| User          | phoneNumber            | Required on create; E.164; login identity | [INFERRED]   |
| Users batch   | users[]                | ≤25 items per request                     | [DOCUMENTED] |
| Time Activity | start.timestamp        | Required; Unix epoch seconds              | [DOCUMENTED] |
| Time Activity | activityTypes          | `shift`/`manual_break`/`time_off`         | [DOCUMENTED] |
| Time Activity | (query window)         | ≤92 days on reads                         | [DOCUMENTED] |
| Shift         | startTime/endTime      | Required; Unix epoch seconds              | [DOCUMENTED] |
| Shifts batch  | shifts[]               | ≤500 on create                            | [DOCUMENTED] |
| Shift delete  | shiftIds[]             | ≤20 on bulk delete                        | [DOCUMENTED] |
| Shift         | group / repeating      | NOT supported via API                     | [DOCUMENTED] |
| Job           | jobId                  | UUID string (never coerce to int)         | [DOCUMENTED] |
| Submission    | answers/questions      | Immutable — only manager fields writable  | [DOCUMENTED] |
| Webhook       | url                    | Must be HTTPS                             | [DOCUMENTED] |
| Webhook       | objectId               | Required unless `featureType=users`       | [DOCUMENTED] |
| Webhook       | featureType/eventTypes | events must belong to the chosen feature  | [DOCUMENTED] |

**Validation/error body** — documented error shape uses a **`detail`** field; full per-status bodies not published (confirm a live 422): `{"detail":"Validation error"}`.

## Server-Side Defaults

| Entity  | Field          | Default               | When Applied         |
| ------- | -------------- | --------------------- | -------------------- |
| User    | userId         | auto-generated int    | create               |
| User    | createdAt      | current epoch seconds | create [INFERRED]    |
| User    | isArchived     | `false`               | create [INFERRED]    |
| Users   | sendActivation | `false`               | create (query param) |
| Shift   | id             | auto-generated hex    | create [INFERRED]    |
| Job     | jobId          | auto-generated UUID   | create [INFERRED]    |
| Job     | isDeleted      | `false`               | create [INFERRED]    |
| Webhook | retryLimit     | `3` (fixed)           | create               |

## Worked Examples

**Onboard a single employee (no invite yet):**

```http
POST /users/v1/users?sendActivation=false
{"users":[{"firstName":"Sam","lastName":"Lee","phoneNumber":"+6421550199"}]}
```

Verify, then send activation separately when ready (or set `sendActivation=true` on create).

**Approve a form submission:**

```http
PUT /forms/v1/forms/555/form_submissions/90001
{"managerFields":{"status":"approved"}}
```

**Bulk-create a week of shifts, then verify:**

```http
POST /scheduler/v2/schedulers/6833518/shifts        body: {"shifts":[ /* up to 500 */ ]}
GET  /scheduler/v2/schedulers/6833518/shifts?startTime=1736163200&endTime=1737372800&limit=100
```

## Dangerous Operations — workspace agent MUST confirm with the user first

| Operation                                    | Why Dangerous                                          | Safeguard                               |
| -------------------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| DELETE users (single / bulk archive)         | Removes/archives employees; likely irreversible        | Confirm; prefer archive over delete     |
| DELETE shifts (bulk ≤20 / single)            | Removes scheduled work silently                        | Confirm exact ids; never auto-delete    |
| DELETE unavailability                        | Affects scheduling/assignment                          | Confirm before removing                 |
| POST clock-in / clock-out                    | Non-idempotent; creates/closes payroll-bearing records | Confirm intent; verify state with GET   |
| Create/Update time activities                | Affects timesheets → payroll                           | Confirm hours/dates before writing      |
| POST create users with `sendActivation=true` | Sends real SMS/email invites                           | Confirm recipients before sending       |
| DELETE webhook                               | Stops all event notifications for that feature         | Confirm before removing                 |
| DELETE / soft-delete jobs                    | Detaches cost-codes from activities/shifts             | Confirm; prefer `isDeleted` soft-delete |

## Gotchas

1. **Batch caps differ per resource:** users 25, shift-create 500, shift-delete 20. Exceeding errors.
2. **No idempotency keys.** Clock-in/out and create-users non-idempotent — guard against double-submit, verify with a GET.
3. **Only manager fields of a submission are writable.** Don't edit answer entries.
4. **Group/repeating/task/data-layer shifts can't be written via API.**
5. **Epoch seconds on all write timestamps** (inside `{timestamp, timezone}` for time activities).
6. **No scope gating (unlike OAuth).** A valid key on a sufficient plan can perform any write — guard destructive ops with explicit user confirmation. Only block is **plan tier** (Expert+ / Forms Enterprise-only).
7. **Send `X-API-KEY`, never `Authorization: Bearer`** on writes.
