---
api_name: 'Connecteam API (OAuth)'
api_slug: 'connecteam-oauth'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Connecteam (OAuth) -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. All write patterns: create, update, delete, clock-in/out,
> state transitions, batch operations, and async auto-assign.
>
> **Shared API:** identical to the `connecteam-api` (API-key) connector — only auth differs.
> **Write scopes required.** OAuth scopes are `feature.permission` (e.g. `users.write`, `schedule.write`,
> `schedule.delete`) and are **immutable after app creation**. If a write 403s, the app lacks that scope —
> a new app must be created. The registry default scopes are `forms.read attachments.write`, so most
> writes below will be **out of scope** unless the connector app was created with broader scopes. [DOCUMENTED]

---

## Write Capabilities Summary

| Operation              | Supported | Method   | Notes                                                   |
| ---------------------- | --------- | -------- | ------------------------------------------------------- |
| Create users           | Yes       | POST     | Batch ≤ 25 per request [DOCUMENTED]                     |
| Update users           | Yes       | PUT      | Batch (same ≤25 cap assumed) [INFERRED]                 |
| Archive / unarchive    | Yes       | POST/PUT | Per Users module [DOCUMENTED]                           |
| Delete users           | Yes       | DELETE   | Destructive — confirm with user [DOCUMENTED]            |
| Create time activities | Yes       | POST     | shift/break/timeoff records [DOCUMENTED]                |
| Update time activities | Yes       | PUT      | [DOCUMENTED]                                            |
| Clock in / out         | Yes       | POST     | Real-time; **non-idempotent** [DOCUMENTED]              |
| Create shifts          | Yes       | POST     | Batch ≤ 500 per request [DOCUMENTED]                    |
| Update shifts          | Yes       | PUT      | Bulk supported; cap [UNKNOWN] [DOCUMENTED]              |
| Delete shifts (bulk)   | Yes       | DELETE   | Batch ≤ 20 per request — destructive [DOCUMENTED]       |
| Delete shift (single)  | Yes       | DELETE   | `/shifts/{shiftId}` — destructive [DOCUMENTED]          |
| Add unavailability     | Yes       | POST     | [DOCUMENTED]                                            |
| Remove unavailability  | Yes       | DELETE   | Destructive [DOCUMENTED]                                |
| Update submission      | Partial   | PUT      | **Manager fields only**; answers immutable [DOCUMENTED] |
| Auto-assign shifts     | Yes       | POST     | Async → poll `requestId` [DOCUMENTED]                   |
| Upload attachment      | Yes       | POST     | `/attachments/v1/...` paths [INFERRED]                  |
| Create webhook         | Yes       | POST     | `/settings/v1/webhooks` [DOCUMENTED]                    |
| Idempotency keys       | No        | —        | None documented — guard non-idempotent POSTs [UNKNOWN]  |

---

## Common Patterns

### Pattern 1: Create users (batch ≤ 25)

```http
POST /users/v1/users?sendActivation=false
Host: api.connecteam.com
Authorization: Bearer {access_token}
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
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "users": [ { "userId": 4815162, "email": "jane.doe@acme.com" } ]
}
```

[INFERRED — body shape deduced from the create endpoint; `userId` keys each item. Verify against a live call.]

---

### Pattern 3: Create a time activity (shift / break / timeoff)

```http
POST /time-clock/v1/time-clocks/12345/time-activities
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "timeActivities": [
    { "userId": 4815162, "type": "shift", "start": 1716969600, "end": 1716998400 }
  ]
}
```

**Notes:**

- `start`/`end` are **Unix epoch seconds**. [DOCUMENTED]
- Omit `end` to create an open (in-progress) activity. [INFERRED]
- `type` ∈ `shift` / `break` / `timeoff`. [DOCUMENTED]

---

### Pattern 4: Real-time clock-in / clock-out

```http
POST /time-clock/v1/time-clocks/12345/clock-in
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{ "userId": 4815162 }
```

```http
POST /time-clock/v1/time-clocks/12345/clock-out
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{ "userId": 4815162 }
```

> **Non-idempotent and side-effecting.** Calling clock-in twice can create a duplicate open activity;
> clock-out on an already-closed activity may error. Confirm intent and verify state with a GET. [DOCUMENTED]

---

### Pattern 5: Create shifts (batch ≤ 500)

```http
POST /scheduler/v1/schedulers/321/shifts
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "shifts": [
    { "type": "regular", "assignees": [4815162], "startTime": 1716969600, "endTime": 1716998400 }
  ]
}
```

**Notes:**

- **Max 500 shifts per request.** [DOCUMENTED]
- `startTime`/`endTime` are epoch seconds. [DOCUMENTED]
- **Cannot** create data layers, shift tasks, repeating, or group shifts via the API. [DOCUMENTED]

---

### Pattern 6: Delete shifts (bulk ≤ 20, or single)

```http
DELETE /scheduler/v1/schedulers/321/shifts
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{ "shiftIds": [987654, 987655] }
```

```http
DELETE /scheduler/v1/schedulers/321/shifts/987654
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

> **Destructive — confirm with the user first.** Bulk delete is capped at **20** ids. Body shape
> (`shiftIds`) is [INFERRED]; the ≤20 cap is [DOCUMENTED].

---

### Pattern 7: Update form-submission manager fields (the only writable part)

```http
PUT /forms/v1/forms/555/form-submissions/90001
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "managerFields": { "status": "approved", "note": "Reviewed by Pat", "date": 1717113600 }
}
```

> Answer entries are **immutable** — only `person` / `status` / `note` / `date` manager fields can be set.
> Path/route [INFERRED]; manager-field-only constraint [DOCUMENTED].

---

### Pattern 8: Async auto-assign shifts (start + poll)

```http
POST /scheduler/v1/schedulers/321/shifts/auto-assign
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{ "shiftIds": [987654, 987655] }
```

Returns a `requestId`; poll until complete:

```http
GET /scheduler/v1/schedulers/321/shifts/auto-assign/{requestId}
Host: api.connecteam.com
Authorization: Bearer {access_token}
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
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "name": "Numa user sync",
  "url": "https://example.com/hooks/connecteam",
  "feature": "users",
  "events": ["user_created", "user_updated"],
  "secretKey": "whsec_…",
  "retryLimit": 3
}
```

[DOCUMENTED — body shape from the webhook setup doc. `url` must be HTTPS.]

---

## Field Validation Rules

> Rules the API enforces on write operations.

| Entity        | Field              | Rule                                      | Source       |
| ------------- | ------------------ | ----------------------------------------- | ------------ |
| User          | firstName/lastName | Required on create                        | [INFERRED]   |
| User          | phoneNumber        | Required on create; E.164; login identity | [INFERRED]   |
| Users batch   | users[]            | ≤ 25 items per request                    | [DOCUMENTED] |
| Time Activity | start              | Required; Unix epoch seconds              | [DOCUMENTED] |
| Time Activity | type               | Must be `shift` / `break` / `timeoff`     | [DOCUMENTED] |
| Time Activity | (query window)     | ≤ 92 days on reads                        | [DOCUMENTED] |
| Shift         | startTime/endTime  | Required; Unix epoch seconds              | [DOCUMENTED] |
| Shifts batch  | shifts[]           | ≤ 500 on create                           | [DOCUMENTED] |
| Shift delete  | shiftIds[]         | ≤ 20 on bulk delete                       | [DOCUMENTED] |
| Shift         | type=group         | Group shifts NOT supported via API        | [DOCUMENTED] |
| Submission    | entries            | Immutable — only manager fields writable  | [DOCUMENTED] |
| Webhook       | url                | Must be HTTPS                             | [DOCUMENTED] |
| Webhook       | feature/events     | events must belong to the chosen feature  | [DOCUMENTED] |

**Validation error format** [INFERRED — confirm against a live 422]:

```json
{
  "requestId": "req_8f3c1a",
  "statusCode": 422,
  "message": "Validation error",
  "detail": [{ "loc": ["body", "users", 0, "phoneNumber"], "msg": "field required", "type": "value_error.missing" }]
}
```

---

## Server-Side Defaults

| Entity | Field          | Default               | When Applied                      |
| ------ | -------------- | --------------------- | --------------------------------- |
| User   | userId         | auto-generated int    | create                            |
| User   | createdAt      | current epoch seconds | create [INFERRED]                 |
| User   | userStatus     | `active`              | create [INFERRED]                 |
| Users  | sendActivation | `false`               | create (query param) [DOCUMENTED] |
| Shift  | shiftId        | auto-generated        | create [INFERRED]                 |

---

## Worked Examples

### Example 1: Onboard a single employee (no invite yet)

```http
POST /users/v1/users?sendActivation=false
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{ "users": [ { "firstName": "Sam", "lastName": "Lee", "phoneNumber": "+6421550199" } ] }
```

Then verify and, when ready, send the activation separately (or set `sendActivation=true` on create).

### Example 2: Approve a form submission

```http
PUT /forms/v1/forms/555/form-submissions/90001
Host: api.connecteam.com
Authorization: Bearer {access_token}
Content-Type: application/json

{ "managerFields": { "status": "approved" } }
```

### Example 3: Bulk-create a week of shifts, then verify

```http
POST /scheduler/v1/schedulers/321/shifts
... body: { "shifts": [ /* up to 500 */ ] }
```

Then read back to confirm:

```http
GET /scheduler/v1/schedulers/321/shifts?startTime=1716163200&endTime=1717372800&limit=100
```

---

## Dangerous Operations

> Destructive / irreversible / side-effecting. The workspace agent **must confirm with the user first.**

| Operation                                    | Why Dangerous                                          | Safeguard                             |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| DELETE users                                 | Removes employees; likely irreversible                 | Confirm; prefer archive over delete   |
| DELETE shifts (bulk ≤20 / single)            | Removes scheduled work silently                        | Confirm exact ids; never auto-delete  |
| DELETE unavailability                        | Affects scheduling/assignment                          | Confirm before removing               |
| POST clock-in / clock-out                    | Non-idempotent; creates/closes payroll-bearing records | Confirm intent; verify state with GET |
| Create/Update time activities                | Affects timesheets → payroll                           | Confirm hours/dates before writing    |
| POST create users with `sendActivation=true` | Sends real SMS/email invites                           | Confirm recipients before sending     |
| DELETE webhook                               | Stops all event notifications for that feature         | Confirm before removing               |

---

## Gotchas & Counter-Exceptions

1. **Batch caps differ per resource:** users 25, shift-create 500, shift-delete 20. Exceeding them errors. [DOCUMENTED]
2. **No idempotency keys.** Clock-in/out and create-users are non-idempotent — guard against double-submit and verify with a GET. [DOCUMENTED/UNKNOWN]
3. **Only manager fields of a submission are writable.** Don't attempt to edit answer entries. [DOCUMENTED]
4. **Group / repeating / task / data-layer shifts can't be written via API.** [DOCUMENTED]
5. **Epoch seconds on all write timestamps.** [DOCUMENTED]
6. **Registry default scopes are read-biased (`forms.read attachments.write`).** Most writes here need broader scopes that may not be granted — expect 403 until the OAuth app is created with `*.write` scopes. [DOCUMENTED]

---

_Generated from the investigation questionnaire, Phases 3-4. Shared verbatim with the `connecteam-api` connector._
