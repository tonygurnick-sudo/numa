---
api_name: Connecteam API (OAuth)
api_slug: connecteam-oauth
base_url: https://api.connecteam.com
path_version_segment: per-module (/users/v1, …); NO global /v1
field_casing: camelCase
timestamps: Unix epoch SECONDS
call_surface: HTTP via `numa integrations request`
confidence: facts [DOCUMENTED] unless tagged [INFERRED]/[UNKNOWN]
shared_api: identical to connecteam-api (API-key); only auth differs
write_scopes: OAuth scopes are `feature.permission` (e.g. `users.write`, `schedule.write`, `schedule.delete`), immutable after app creation. Registry default `forms.read attachments.write` → most writes below 403 unless the app was created with broader scopes. A write 403 = app lacks that scope → new app required.
companion_to: 01-llm-api-rules.md
---

# Connecteam (OAuth) — Mutation Patterns Reference

All write patterns: create, update, delete, clock-in/out, state transitions, batch ops, async auto-assign.

## Write Capabilities Summary

| Operation              | Supported | Method   | Notes                                                  |
| ---------------------- | --------- | -------- | ------------------------------------------------------ |
| Create users           | Yes       | POST     | Batch ≤25 per request                                  |
| Update users           | Yes       | PUT      | Batch (same ≤25 cap assumed [INFERRED])                |
| Archive / unarchive    | Yes       | POST/PUT | Per Users module                                       |
| Delete users           | Yes       | DELETE   | Destructive — confirm                                  |
| Create time activities | Yes       | POST     | shift/break/timeoff records                            |
| Update time activities | Yes       | PUT      | —                                                      |
| Clock in / out         | Yes       | POST     | Real-time; **non-idempotent**                          |
| Create shifts          | Yes       | POST     | Batch ≤500 per request                                 |
| Update shifts          | Yes       | PUT      | Bulk; cap [UNKNOWN]                                    |
| Delete shifts (bulk)   | Yes       | DELETE   | Batch ≤20 — destructive                                |
| Delete shift (single)  | Yes       | DELETE   | `/shifts/{shiftId}` — destructive                      |
| Add unavailability     | Yes       | POST     | —                                                      |
| Remove unavailability  | Yes       | DELETE   | Destructive                                            |
| Update submission      | Partial   | PUT      | **Manager fields only**; answers immutable             |
| Auto-assign shifts     | Yes       | POST     | Async → poll `requestId`                               |
| Upload attachment      | Yes       | POST     | `/attachments/v1/...` [INFERRED]                       |
| Create webhook         | Yes       | POST     | `/settings/v1/webhooks`                                |
| Idempotency keys       | No        | —        | None documented — guard non-idempotent POSTs [UNKNOWN] |

## Common Patterns

All requests: `Authorization: Bearer {access_token}`, `Content-Type: application/json`, host `api.connecteam.com` (AU: `api-au.connecteam.com`).

### Pattern 1: Create users (batch ≤25)

`POST /users/v1/users?sendActivation=false`
`{"users":[{"firstName":"Jane","lastName":"Doe","phoneNumber":"+14155550101","email":"jane@acme.com"}]}`

- **Max 25 users per request** — split larger batches.
- `phoneNumber` (E.164) is the login identity, generally required [INFERRED].
- `sendActivation` (boolean, default `false`) controls whether the invite SMS/email is sent.
- Non-idempotent — re-running creates duplicates.
- Responses: `200 Successful Response`, `422 Validation Error`.

### Pattern 2: Update users (PUT)

`PUT /users/v1/users` body `{"users":[{"userId":4815162,"email":"jane.doe@acme.com"}]}`
[INFERRED — body deduced from create; `userId` keys each item. Verify live.]

### Pattern 3: Create a time activity (shift/break/timeoff)

`POST /time-clock/v1/time-clocks/12345/time-activities`
`{"timeActivities":[{"userId":4815162,"type":"shift","start":1716969600,"end":1716998400}]}`

- `start`/`end` are **Unix epoch seconds**. Omit `end` for an open (in-progress) activity [INFERRED].
- `type` ∈ `shift`/`break`/`timeoff`.

### Pattern 4: Real-time clock-in / clock-out

`POST /time-clock/v1/time-clocks/12345/clock-in` body `{"userId":4815162}`
`POST /time-clock/v1/time-clocks/12345/clock-out` body `{"userId":4815162}`

> **Non-idempotent and side-effecting.** Clock-in twice can create a duplicate open activity; clock-out on an already-closed activity may error. Confirm intent; verify state with a GET.

### Pattern 5: Create shifts (batch ≤500)

`POST /scheduler/v1/schedulers/321/shifts`
`{"shifts":[{"type":"regular","assignees":[4815162],"startTime":1716969600,"endTime":1716998400}]}`

- **Max 500 shifts per request.** `startTime`/`endTime` epoch seconds.
- **Cannot** create data layers, shift tasks, repeating, or group shifts via the API.

### Pattern 6: Delete shifts (bulk ≤20, or single)

`DELETE /scheduler/v1/schedulers/321/shifts` body `{"shiftIds":[987654,987655]}`
`DELETE /scheduler/v1/schedulers/321/shifts/987654`

> **Destructive — confirm first.** Bulk delete capped at **20** ids. Body shape (`shiftIds`) [INFERRED]; ≤20 cap [DOCUMENTED].

### Pattern 7: Update form-submission manager fields (the only writable part)

`PUT /forms/v1/forms/555/form-submissions/90001`
`{"managerFields":{"status":"approved","note":"Reviewed by Pat","date":1717113600}}`

> Answer entries are **immutable** — only `person`/`status`/`note`/`date` manager fields can be set. Path/route [INFERRED]; manager-field-only constraint [DOCUMENTED].

### Pattern 8: Async auto-assign shifts (start + poll)

`POST /scheduler/v1/schedulers/321/shifts/auto-assign` body `{"shiftIds":[987654,987655]}` → returns a `requestId`; poll:
`GET /scheduler/v1/schedulers/321/shifts/auto-assign/{requestId}` → `{"requestId":"asg_123","status":"pending"}`
[Async pattern DOCUMENTED; request body shape INFERRED. Poll on backoff; respect rate limits.]

### Pattern 9: Create a webhook subscription

`POST /settings/v1/webhooks`
`{"name":"Numa user sync","url":"https://example.com/hooks/connecteam","feature":"users","events":["user_created","user_updated"],"secretKey":"whsec_…","retryLimit":3}`
[Body shape from the webhook setup doc. `url` must be HTTPS.]

## Field Validation Rules

| Entity        | Field              | Rule                                      | Source       |
| ------------- | ------------------ | ----------------------------------------- | ------------ |
| User          | firstName/lastName | Required on create                        | [INFERRED]   |
| User          | phoneNumber        | Required on create; E.164; login identity | [INFERRED]   |
| Users batch   | users[]            | ≤25 items per request                     | [DOCUMENTED] |
| Time Activity | start              | Required; Unix epoch seconds              | [DOCUMENTED] |
| Time Activity | type               | `shift`/`break`/`timeoff`                 | [DOCUMENTED] |
| Time Activity | (query window)     | ≤92 days on reads                         | [DOCUMENTED] |
| Shift         | startTime/endTime  | Required; Unix epoch seconds              | [DOCUMENTED] |
| Shifts batch  | shifts[]           | ≤500 on create                            | [DOCUMENTED] |
| Shift delete  | shiftIds[]         | ≤20 on bulk delete                        | [DOCUMENTED] |
| Shift         | type=group         | Group shifts NOT supported via API        | [DOCUMENTED] |
| Submission    | entries            | Immutable — only manager fields writable  | [DOCUMENTED] |
| Webhook       | url                | Must be HTTPS                             | [DOCUMENTED] |
| Webhook       | feature/events     | events must belong to the chosen feature  | [DOCUMENTED] |

**Validation error format** [INFERRED — confirm against a live 422]:
`{"requestId":"req_8f3c1a","statusCode":422,"message":"Validation error","detail":[{"loc":["body","users",0,"phoneNumber"],"msg":"field required","type":"value_error.missing"}]}`

## Server-Side Defaults

| Entity | Field          | Default               | When Applied         |
| ------ | -------------- | --------------------- | -------------------- |
| User   | userId         | auto-generated int    | create               |
| User   | createdAt      | current epoch seconds | create [INFERRED]    |
| User   | userStatus     | `active`              | create [INFERRED]    |
| Users  | sendActivation | `false`               | create (query param) |
| Shift  | shiftId        | auto-generated        | create [INFERRED]    |

> **Onboard without inviting yet:** create with `sendActivation=false`, then send activation separately when ready (or set `sendActivation=true` on create). **Bulk writes:** read back with a GET to confirm.

## Dangerous Operations

> Destructive / irreversible / side-effecting. **Must confirm with the user first.**

| Operation                                    | Why Dangerous                                          | Safeguard                             |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| DELETE users                                 | Removes employees; likely irreversible                 | Confirm; prefer archive over delete   |
| DELETE shifts (bulk ≤20 / single)            | Removes scheduled work silently                        | Confirm exact ids; never auto-delete  |
| DELETE unavailability                        | Affects scheduling/assignment                          | Confirm before removing               |
| POST clock-in / clock-out                    | Non-idempotent; creates/closes payroll-bearing records | Confirm intent; verify state with GET |
| Create/Update time activities                | Affects timesheets → payroll                           | Confirm hours/dates before writing    |
| POST create users with `sendActivation=true` | Sends real SMS/email invites                           | Confirm recipients before sending     |
| DELETE webhook                               | Stops all event notifications for that feature         | Confirm before removing               |

## Gotchas

1. **Batch caps differ per resource:** users 25, shift-create 500, shift-delete 20. Exceeding them errors.
2. **No idempotency keys.** Clock-in/out and create-users are non-idempotent — guard against double-submit; verify with a GET.
3. **Only manager fields of a submission are writable.** Don't edit answer entries.
4. **Group / repeating / task / data-layer shifts can't be written via API.**
5. **Epoch seconds on all write timestamps.**
6. **Registry default scopes are read-biased (`forms.read attachments.write`).** Most writes here need broader scopes — expect 403 until the OAuth app is created with `*.write` scopes.
