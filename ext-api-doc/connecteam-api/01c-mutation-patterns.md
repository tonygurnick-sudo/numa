---
api_name: 'Connecteam (API Key)'
api_slug: 'connecteam-api'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Connecteam (API Key) -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. All write patterns: create, update, delete, clock-in/out,
> state transitions, batch operations, and async auto-assign.
>
> **Shared API:** identical to the `connecteam-oauth` connector — **only auth differs**. Every write below
> is the same call; just send `X-API-KEY: {api_token}` instead of `Authorization: Bearer {token}`.
>
> **Permissions model — simpler than OAuth.** This connector uses a single account-level API key with
> **full account access** (no scope model). Unlike the OAuth connector — whose immutable `feature.permission`
> scopes can make a write 403 — an API key that is valid and on a sufficient plan can perform any write the
> account's plan allows. The only gating is **plan tier** (Expert+; Forms is Enterprise-only), not scopes.

---

## Write Capabilities Summary

| Operation              | Supported | Method   | Notes                                                              |
| ---------------------- | --------- | -------- | ------------------------------------------------------------------ |
| Create users           | Yes       | POST     | Batch ≤ 25 per request [DOCUMENTED]                                |
| Update users           | Yes       | PUT      | Batch (same ≤25 cap assumed) [INFERRED]                            |
| Promote to admin       | Yes       | POST     | `/users/v1/admins` [DOCUMENTED]                                    |
| Archive users          | Yes       | DELETE   | `DELETE /users/v1/users` (bulk archive) — destructive [DOCUMENTED] |
| Delete user            | Yes       | DELETE   | `DELETE /users/v1/users/{userId}` — destructive [DOCUMENTED]       |
| Create time activities | Yes       | POST     | shift / manual_break / time_off records [DOCUMENTED]               |
| Update time activities | Yes       | PUT      | [DOCUMENTED]                                                       |
| Clock in / out         | Yes       | POST     | Real-time; **non-idempotent** [DOCUMENTED]                         |
| Create shifts          | Yes       | POST     | Batch ≤ 500 per request [DOCUMENTED]                               |
| Update shifts          | Yes       | PUT      | Bulk supported; cap [UNKNOWN] [DOCUMENTED]                         |
| Delete shifts (bulk)   | Yes       | DELETE   | Batch ≤ 20 per request — destructive [DOCUMENTED]                  |
| Delete shift (single)  | Yes       | DELETE   | `/shifts/{shiftId}` — destructive [DOCUMENTED]                     |
| Add unavailability     | Yes       | POST     | [DOCUMENTED]                                                       |
| Remove unavailability  | Yes       | DELETE   | Destructive [DOCUMENTED]                                           |
| Create / update jobs   | Yes       | POST/PUT | Jobs use UUID ids; soft-delete via DELETE/`isDeleted` [DOCUMENTED] |
| Update submission      | Partial   | PUT      | **Manager fields only**; answers immutable [DOCUMENTED]            |
| Auto-assign shifts     | Yes       | POST     | Async → poll `requestId` [DOCUMENTED]                              |
| Upload attachment      | Yes       | POST/PUT | Two-step pre-signed flow [DOCUMENTED]                              |
| Create webhook         | Yes       | POST     | `/settings/v1/webhooks` [DOCUMENTED]                               |
| Idempotency keys       | No        | —        | None documented — guard non-idempotent POSTs [UNKNOWN]             |

---

## Common Patterns

### Pattern 1: Create users (batch ≤ 25)

```http
POST /users/v1/users?sendActivation=false
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{
  "users": [
    { "firstName": "Jane", "lastName": "Doe", "phoneNumber": "+14155550101", "email": "jane@acme.com" }
  ]
}
```

**Notes:**

- **Max 25 users per request.** Split larger batches. [DOCUMENTED]
- `phoneNumber` (E.164) is the login identity and is generally required. [INFERRED]
- `sendActivation` (boolean, default `false`) controls whether the invite SMS/email is sent. [DOCUMENTED]
- Non-idempotent — re-running creates duplicates. [DOCUMENTED]
- Responses: `200 Successful Response`, `422 Validation Error`. [DOCUMENTED]

---

### Pattern 2: Update users (PUT)

```http
PUT /users/v1/users
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{ "users": [ { "userId": 7031021, "email": "jane.doe@acme.com" } ] }
```

[INFERRED — body shape deduced from the create endpoint; `userId` keys each item. Verify against a live call.]

---

### Pattern 3: Create time activities (shift / manual_break / time_off)

```http
POST /time_clock/v1/time_clocks/12345/time_activities
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{
  "timeActivities": [
    {
      "userId": 9170357,
      "shifts": [
        {
          "start": { "timestamp": 1704110400, "timezone": "America/New_York" },
          "end": { "timestamp": 1704139200, "timezone": "America/New_York" },
          "jobId": "9fdebf1f-0c69-4914-89d2-8f86c3e5f47d",
          "employeeNote": "Imported from external system"
        }
      ],
      "manualbreaks": []
    }
  ]
}
```

**Notes:**

- `start.timestamp` / `end.timestamp` are **Unix epoch seconds**, inside a `{ timestamp, timezone }` object. [DOCUMENTED]
- Omit `end` to create an open (in-progress) activity. [INFERRED]
- `jobId` is a **UUID string**. [DOCUMENTED]

---

### Pattern 4: Real-time clock-in / clock-out

```http
POST /time_clock/v1/time_clocks/12345/clock_in
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{ "userId": 9170357 }
```

```http
POST /time_clock/v1/time_clocks/12345/clock_out
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{ "userId": 9170357 }
```

> **Non-idempotent and side-effecting.** Calling clock-in twice can create a duplicate open activity;
> clock-out on an already-closed activity may error. Confirm intent and verify state with a GET. [DOCUMENTED]

---

### Pattern 5: Create shifts (batch ≤ 500, V2)

```http
POST /scheduler/v2/schedulers/6833518/shifts
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{
  "shifts": [
    { "title": "Morning Shift", "assignedUserIds": [9170357],
      "startTime": 1736924400, "endTime": 1736953200,
      "jobId": "d4ad7232-576f-2ff6-c57d-8240f1089b00", "isPublished": true }
  ]
}
```

**Notes:**

- **Max 500 shifts per request.** [DOCUMENTED]
- `startTime`/`endTime` are epoch seconds; `assignedUserIds` are integers; `jobId` is a UUID. [DOCUMENTED]
- **Cannot** create data layers, shift tasks, repeating, or group shifts via the API. [DOCUMENTED]
- Default to **V2**; V1 (`/scheduler/v1/...`) remains available. [DOCUMENTED]

---

### Pattern 6: Delete shifts (bulk ≤ 20, or single)

```http
DELETE /scheduler/v2/schedulers/6833518/shifts
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{ "shiftIds": ["6784dacb3c07733b0a849f49", "6784dacb3c07733b0a849f4a"] }
```

```http
DELETE /scheduler/v2/schedulers/6833518/shifts/6784dacb3c07733b0a849f49
Host: api.connecteam.com
X-API-KEY: {api_token}
```

> **Destructive — confirm with the user first.** Bulk delete is capped at **20** ids. Shift ids are
> hex strings. Body shape (`shiftIds`) is [INFERRED]; the ≤20 cap is [DOCUMENTED].

---

### Pattern 7: Update form-submission manager fields (the only writable part)

```http
PUT /forms/v1/forms/555/form_submissions/90001
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{ "managerFields": { "status": "approved", "note": "Reviewed by Pat", "date": 1717113600 } }
```

> Answer entries are **immutable** — only `person` / `status` / `note` / `date` manager fields can be set.
> Forms API is **Enterprise-only**. Path/route [INFERRED]; manager-field-only constraint [DOCUMENTED].

---

### Pattern 8: Async auto-assign shifts (start + poll)

```http
POST /scheduler/v2/schedulers/6833518/shifts_auto_assign
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{ "shiftIds": ["6784dacb3c07733b0a849f49"] }
```

Returns a `requestId`; poll until complete:

```http
GET /scheduler/v2/schedulers/6833518/shifts_auto_assign/{requestId}
Host: api.connecteam.com
X-API-KEY: {api_token}
```

```json
{ "requestId": "asg_123", "status": "pending" }
```

[DOCUMENTED — async pattern; request body shape [INFERRED]. Poll on a backoff; respect rate limits.]

---

### Pattern 9: Create a webhook subscription

```http
POST /settings/v1/webhooks
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{
  "name": "Numa user sync",
  "url": "https://example.com/hooks/connecteam",
  "featureType": "users",
  "eventTypes": ["user_created", "user_updated", "user_archived"],
  "secretKey": "whsec_…",
  "isDisabled": false
}
```

> `objectId` is required for every `featureType` **except `users`**. `url` must be HTTPS. `secretKey`
> is optional (signature verification). [DOCUMENTED — body shape from the webhook setup doc.]

---

## Field Validation Rules

> Rules the API enforces on write operations.

| Entity        | Field                  | Rule                                      | Source       |
| ------------- | ---------------------- | ----------------------------------------- | ------------ |
| User          | firstName/lastName     | Required on create                        | [INFERRED]   |
| User          | phoneNumber            | Required on create; E.164; login identity | [INFERRED]   |
| Users batch   | users[]                | ≤ 25 items per request                    | [DOCUMENTED] |
| Time Activity | start.timestamp        | Required; Unix epoch seconds              | [DOCUMENTED] |
| Time Activity | activityTypes          | `shift` / `manual_break` / `time_off`     | [DOCUMENTED] |
| Time Activity | (query window)         | ≤ 92 days on reads                        | [DOCUMENTED] |
| Shift         | startTime/endTime      | Required; Unix epoch seconds              | [DOCUMENTED] |
| Shifts batch  | shifts[]               | ≤ 500 on create                           | [DOCUMENTED] |
| Shift delete  | shiftIds[]             | ≤ 20 on bulk delete                       | [DOCUMENTED] |
| Shift         | group / repeating      | NOT supported via API                     | [DOCUMENTED] |
| Job           | jobId                  | UUID string (never coerce to int)         | [DOCUMENTED] |
| Submission    | answers/questions      | Immutable — only manager fields writable  | [DOCUMENTED] |
| Webhook       | url                    | Must be HTTPS                             | [DOCUMENTED] |
| Webhook       | objectId               | Required unless `featureType=users`       | [DOCUMENTED] |
| Webhook       | featureType/eventTypes | events must belong to the chosen feature  | [DOCUMENTED] |

**Validation / error body** — the documented error shape uses a **`detail`** field; full per-status bodies
are not published (confirm a live 422):

```json
{ "detail": "Validation error" }
```

---

## Server-Side Defaults

| Entity  | Field          | Default               | When Applied                      |
| ------- | -------------- | --------------------- | --------------------------------- |
| User    | userId         | auto-generated int    | create                            |
| User    | createdAt      | current epoch seconds | create [INFERRED]                 |
| User    | isArchived     | `false`               | create [INFERRED]                 |
| Users   | sendActivation | `false`               | create (query param) [DOCUMENTED] |
| Shift   | id             | auto-generated hex    | create [INFERRED]                 |
| Job     | jobId          | auto-generated UUID   | create [INFERRED]                 |
| Job     | isDeleted      | `false`               | create [INFERRED]                 |
| Webhook | retryLimit     | `3` (fixed)           | create [DOCUMENTED]               |

---

## Worked Examples

### Example 1: Onboard a single employee (no invite yet)

```http
POST /users/v1/users?sendActivation=false
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{ "users": [ { "firstName": "Sam", "lastName": "Lee", "phoneNumber": "+6421550199" } ] }
```

Then verify and, when ready, send the activation separately (or set `sendActivation=true` on create).

### Example 2: Approve a form submission

```http
PUT /forms/v1/forms/555/form_submissions/90001
Host: api.connecteam.com
X-API-KEY: {api_token}
Content-Type: application/json

{ "managerFields": { "status": "approved" } }
```

### Example 3: Bulk-create a week of shifts, then verify

```http
POST /scheduler/v2/schedulers/6833518/shifts
... body: { "shifts": [ /* up to 500 */ ] }
```

Then read back to confirm:

```http
GET /scheduler/v2/schedulers/6833518/shifts?startTime=1736163200&endTime=1737372800&limit=100
X-API-KEY: {api_token}
```

---

## Dangerous Operations

> Destructive / irreversible / side-effecting. The workspace agent **must confirm with the user first.**

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

---

## Gotchas & Counter-Exceptions

1. **Batch caps differ per resource:** users 25, shift-create 500, shift-delete 20. Exceeding them errors. [DOCUMENTED]
2. **No idempotency keys.** Clock-in/out and create-users are non-idempotent — guard against double-submit and verify with a GET. [DOCUMENTED/UNKNOWN]
3. **Only manager fields of a submission are writable.** Don't attempt to edit answer entries. [DOCUMENTED]
4. **Group / repeating / task / data-layer shifts can't be written via API.** [DOCUMENTED]
5. **Epoch seconds on all write timestamps** (inside `{timestamp, timezone}` for time activities). [DOCUMENTED]
6. **No scope gating (unlike OAuth).** A valid key on a sufficient plan can perform any write — so guard
   destructive ops with explicit user confirmation rather than relying on scope restrictions. The only
   block is **plan tier** (Expert+ / Forms Enterprise-only). [DOCUMENTED]
7. **Send `X-API-KEY`, never `Authorization: Bearer`** on writes. [DOCUMENTED]

---

_Generated from the investigation questionnaire, Phases 3-4. Mutation behaviour shared with the
`connecteam-oauth` connector — only the auth header and the (absent) scope model differ._
