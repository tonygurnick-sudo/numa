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
companion_to: 01-llm-api-rules.md
---

# Connecteam (OAuth) — Query Patterns Reference

All read patterns: filtering, search, sorting, pagination, bulk reads.

## Query Capabilities Summary

| Capability                      | Supported          | Syntax                                                                                                        | Notes                                |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Filter by field value           | Yes (per-endpoint) | `?userStatus=active`                                                                                          | Whitelisted params only              |
| Filter by id list               | Yes                | `?userIds=1,2,3`                                                                                              | Array params                         |
| Filter by date range            | Yes                | epoch-second params (`submittingStartTimestamp`, `submittingEndTime`, `createdAt`, time-activity window ≤92d) | —                                    |
| Full-text search                | No                 | —                                                                                                             | No search endpoint [INFERRED]        |
| Sort by field                   | Limited            | `?sort=created_at`                                                                                            | Only `created_at` documented (users) |
| Sort direction                  | Yes                | `?order=asc`/`desc`                                                                                           | —                                    |
| Field selection / sparse fields | No                 | —                                                                                                             | [INFERRED]                           |
| Include related records         | No                 | —                                                                                                             | Use child endpoints [INFERRED]       |
| Aggregate / count               | Partial            | Timesheet aggregates hours                                                                                    | No generic count                     |
| Logical AND                     | Yes                | Multiple params AND-combined                                                                                  | [INFERRED]                           |
| Logical OR                      | No                 | —                                                                                                             | [INFERRED]                           |
| Comparison ops (gt/lt)          | No                 | Use explicit from/to params                                                                                   | [INFERRED]                           |

## Filter Syntax

Whitelisted query-string params per endpoint:

```
GET /users/v1/users?userStatus=archived&order=desc&limit=100
GET /forms/v1/forms/{formId}/form-submissions?submittingStartTimestamp=1714521600&submittingEndTime=1717200000&userIds=4815162
GET /time-clock/v1/time-clocks/{id}/time-activities?startTime=1714521600&endTime=1717200000   (≤92 days)
```

(`startTime`/`endTime` slugs for time-activities [INFERRED].)

### Users list — full filter set

| Parameter                                       | Type              | Default  | Description               |
| ----------------------------------------------- | ----------------- | -------- | ------------------------- |
| limit                                           | integer (1–500)   | 10       | Page size                 |
| offset                                          | integer (≥0)      | 0        | Start position            |
| sort                                            | string            | —        | Allowed: `created_at`     |
| order                                           | enum              | `asc`    | `asc`/`desc`              |
| userIds                                         | array<int>        | —        | Specific user ids         |
| userStatus                                      | enum              | `active` | `active`/`archived`/`all` |
| fullNames                                       | array<string>     | —        | Filter by name            |
| phoneNumbers                                    | array<string>     | —        | Filter by phone           |
| emailAddresses                                  | array<string>     | —        | Filter by email           |
| createdAt / modifiedAt / lastLogin / archivedAt | integer (epoch s) | —        | Time filters              |

### Form submissions — filter set

| Parameter                | Type          | Default | Description            |
| ------------------------ | ------------- | ------- | ---------------------- |
| userIds                  | array<int>    | —       | Filter by submitter    |
| submittingStartTimestamp | integer (s)   | —       | Window start (epoch s) |
| submittingEndTime        | integer (s)   | —       | Window end (epoch s)   |
| limit                    | integer 1–100 | 10      | Page size (max 100)    |
| offset                   | integer ≥0    | 0       | Start position         |

### Filter rules & gotchas

- Multiple params are **AND-combined**. No OR, no nesting, no comparison ops (`gt`/`lt`) — use explicit from/to epoch-second params [INFERRED].
- **Array params are exact-match only** (`userIds`, `fullNames`, `phoneNumbers`). No partial/fuzzy.
- **Epoch seconds, not ISO**, on every time filter.
- **Time-activity windows capped at 92 days** — split wider ranges into ≤90-day chunks.
- **`sort` is effectively `created_at`-only** (documented for users). Other endpoints: assume server-default ordering.

## Field Selection

Not supported — endpoints return their full schema. No `columns`/`fields` param. [INFERRED]

## Search Capabilities

No global search endpoint [INFERRED]. Per-resource: value filters only — exact-match id/name/phone/email arrays. No fuzzy/wildcard [INFERRED]. To "search" a user by name: pass full name(s) to `fullNames`, or list all and filter client-side.

## Common Patterns

1. **Active users, newest first:** `GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=100&offset=0`
2. **Pay-period shifts for a scheduler:** `GET /scheduler/v1/schedulers/321/shifts?startTime=1716163200&endTime=1717372800&limit=100`
3. **Form submissions in a date window for specific users:** `GET /forms/v1/forms/555/form-submissions?userIds=4815162&submittingStartTimestamp=1714521600&submittingEndTime=1717200000&limit=100`
4. **Last 30 days of time activities for a clock (≤92d):** `GET /time-clock/v1/time-clocks/12345/time-activities?startTime=1714521600&endTime=1717113600`
5. **Single user by id:** `GET /users/v1/users/4815162` [INFERRED — by-id route from REST convention; verify live]
6. **Change detection via `modifiedAt`:** `GET /users/v1/users?modifiedAt=1717113600&order=desc&limit=200` — returns users modified at/after the epoch-second timestamp; the recommended polling pattern in place of a change feed.

All requests: `Authorization: Bearer {access_token}`, host `api.connecteam.com` (AU: `api-au.connecteam.com`).

## Pagination

- **Type:** offset/limit. **Default page size:** 10. **Total count:** No — use the "fewer-than-limit" heuristic.
- **Max page size:** endpoint-specific.

| Parameter | Type    | Default | Description       |
| --------- | ------- | ------- | ----------------- |
| limit     | integer | 10      | Items per page    |
| offset    | integer | 0       | Starting position |

**Response shape:** object with a `data` wrapper keyed by resource name (`data.users`, `data.shifts`, `data.formSubmissions`). `requestId`/`paging` likely but not shown verbatim [INFERRED]:
`{"requestId":"req_8f3c1a","data":{"users":[/* ... */]},"paging":{"limit":100,"offset":0}}`

**Last page detection** (verbatim guidance): "Continue incrementing `offset` by `limit` until the response returns fewer items than the limit, indicating you've reached the end." There is **no** `Result-Total` / total-count field.

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items  (full page → continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items  (full page → continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items  (< limit → LAST PAGE, stop)
```

**Per-endpoint page-size caps:**
| Endpoint | Max `limit` | Source |
| --- | --- | --- |
| `/users/v1/users` | 500 | [DOCUMENTED] |
| `/forms/v1/forms/{formId}/form-submissions` | 100 | [DOCUMENTED] |
| others (schedulers, shifts, time-clocks) | [UNKNOWN] | default to 100 conservatively |

## Bulk Reads & Large Datasets

- **No dedicated async export** endpoint. Auto-assign is the only async/polling pattern (`POST …/shifts/auto-assign` → `GET …/shifts/auto-assign/{requestId}`).
- **Rate-limit budgeting:** limits are **per account**, shared across all API clients. On Enterprise (200/min) a full user export at `limit=500` is a handful of calls — but interleave with other activity; cache list reads ~5 min.
- **Form-submission PDF retrieval** referenced in the forum but undocumented [INFERRED].

## Gotchas

1. **No total count.** "Fewer-than-limit" is the only last-page signal.
2. **Default `limit` is just 10.** Always set it explicitly (100 default; up to the endpoint cap).
3. **Form-submissions cap at 100, not 500.** Don't reuse the users cap.
4. **92-day window on time activities.** Wider range rejected — chunk it.
5. **Per-account rate limits are shared** across multiple integrations + this connector.
6. **Epoch seconds everywhere.** Convert ISO/ms to Unix seconds before filtering.
7. **No field selection / no `include`.** Full schema only; fetch child resources separately [INFERRED].
