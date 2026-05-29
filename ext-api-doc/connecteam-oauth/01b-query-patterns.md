---
api_name: 'Connecteam API (OAuth)'
api_slug: 'connecteam-oauth'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Connecteam (OAuth) -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. All read patterns: filtering, search, sorting, pagination, bulk reads.
>
> **Shared API:** identical to the `connecteam-api` (API-key) connector — only auth differs.

---

## Query Capabilities Summary

| Capability                      | Supported          | Syntax                                                                                                        | Notes                                             |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Filter by field value           | Yes (per-endpoint) | `?userStatus=active`                                                                                          | Whitelisted params only [DOCUMENTED]              |
| Filter by id list               | Yes                | `?userIds=1,2,3`                                                                                              | Array params [DOCUMENTED]                         |
| Filter by date range            | Yes                | epoch-second params (`submittingStartTimestamp`, `submittingEndTime`, `createdAt`, time-activity window ≤92d) | [DOCUMENTED]                                      |
| Full-text search                | No                 | —                                                                                                             | No search endpoint [INFERRED]                     |
| Sort by field                   | Limited            | `?sort=created_at`                                                                                            | Only `created_at` documented (users) [DOCUMENTED] |
| Sort direction                  | Yes                | `?order=asc` / `?order=desc`                                                                                  | [DOCUMENTED]                                      |
| Field selection / sparse fields | No                 | —                                                                                                             | Not documented [INFERRED]                         |
| Include related records         | No                 | —                                                                                                             | Use child endpoints instead [INFERRED]            |
| Aggregate / count               | Partial            | Timesheet endpoint aggregates hours                                                                           | No generic count [DOCUMENTED]                     |
| Logical operators (AND)         | Yes                | Multiple params AND-combined                                                                                  | [INFERRED]                                        |
| Logical operators (OR)          | No                 | —                                                                                                             | [INFERRED]                                        |
| Comparison operators (gt/lt)    | No                 | Use explicit from/to params instead                                                                           | [INFERRED]                                        |

---

## Filter Syntax

### General pattern — whitelisted query-string params per endpoint

```
GET /users/v1/users?userStatus=archived&order=desc&limit=100
GET /forms/v1/forms/{formId}/form-submissions?submittingStartTimestamp=1714521600&submittingEndTime=1717200000&userIds=4815162
GET /time-clock/v1/time-clocks/{id}/time-activities?startTime=1714521600&endTime=1717200000   (≤ 92 days)
```

[DOCUMENTED — params confirmed; `startTime`/`endTime` slugs for time-activities are [INFERRED].]

### Users list — full filter set [DOCUMENTED]

| Parameter                                       | Type              | Default  | Description                   |
| ----------------------------------------------- | ----------------- | -------- | ----------------------------- |
| limit                                           | integer (1–500)   | 10       | Page size                     |
| offset                                          | integer (≥0)      | 0        | Start position                |
| sort                                            | string            | —        | Allowed: `created_at`         |
| order                                           | enum              | `asc`    | `asc` / `desc`                |
| userIds                                         | array<int>        | —        | Filter by specific user ids   |
| userStatus                                      | enum              | `active` | `active` / `archived` / `all` |
| fullNames                                       | array<string>     | —        | Filter by name                |
| phoneNumbers                                    | array<string>     | —        | Filter by phone               |
| emailAddresses                                  | array<string>     | —        | Filter by email               |
| createdAt / modifiedAt / lastLogin / archivedAt | integer (epoch s) | —        | Time filters (≥1)             |

### Form submissions — filter set [DOCUMENTED]

| Parameter                | Type          | Default | Description            |
| ------------------------ | ------------- | ------- | ---------------------- |
| userIds                  | array<int>    | —       | Filter by submitter    |
| submittingStartTimestamp | integer (s)   | —       | Window start (epoch s) |
| submittingEndTime        | integer (s)   | —       | Window end (epoch s)   |
| limit                    | integer 1–100 | 10      | Page size (max 100)    |
| offset                   | integer ≥0    | 0       | Start position         |

### Combining filters

Multiple params are **AND-combined**. There is no OR, no nested filtering, and no comparison operators
(`gt`/`lt`) — use explicit from/to epoch-second params for ranges. [INFERRED]

### Gotchas

- **Array params are exact-match only** (e.g. `userIds`, `fullNames`, `phoneNumbers`). No partial/fuzzy matching. [DOCUMENTED]
- **Epoch seconds, not ISO.** Every time filter is Unix seconds. [DOCUMENTED]
- **Time-activity windows are capped at 92 days** — split wider ranges into ≤ 90-day chunks. [DOCUMENTED]
- **`sort` is effectively `created_at`-only** (documented for users). Don't assume arbitrary sort keys. [DOCUMENTED]

---

## Sort Syntax

```
?sort=created_at&order=asc
?sort=created_at&order=desc
```

Only `created_at` is a documented sort key (users). Other endpoints' sort support is undocumented —
assume server-default ordering. [DOCUMENTED / INFERRED]

---

## Field Selection

Not supported — endpoints return their full documented schema. There is no `columns`/`fields` param. [INFERRED]

---

## Search Capabilities

- **Global search endpoint:** none. [INFERRED]
- **Per-resource search:** value filters only — exact-match id/name/phone/email arrays. [DOCUMENTED]
- **Fuzzy / wildcard matching:** not supported. [INFERRED]
- **To "search" a user by name:** pass the full name(s) to `fullNames`, or list all and filter client-side. [DOCUMENTED]

---

## Common Patterns

### Pattern 1: Active users, newest first

```http
GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=100&offset=0
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

### Pattern 2: This pay-period's shifts for a scheduler

```http
GET /scheduler/v1/schedulers/321/shifts?startTime=1716163200&endTime=1717372800&limit=100
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

### Pattern 3: Form submissions in a date window for specific users

```http
GET /forms/v1/forms/555/form-submissions?userIds=4815162&submittingStartTimestamp=1714521600&submittingEndTime=1717200000&limit=100
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

### Pattern 4: Last 30 days of time activities for a clock (within the 92-day cap)

```http
GET /time-clock/v1/time-clocks/12345/time-activities?startTime=1714521600&endTime=1717113600
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

### Pattern 5: Get a single user by id

```http
GET /users/v1/users/4815162
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

[INFERRED — by-id route deduced from REST convention; verify against a live call.]

### Pattern 6: Change detection via `modifiedAt`

```http
GET /users/v1/users?modifiedAt=1717113600&order=desc&limit=200
Host: api.connecteam.com
Authorization: Bearer {access_token}
```

Returns users modified at/after the epoch-second timestamp — the recommended polling pattern in place of
a change feed. [DOCUMENTED]

---

## Pagination Handling

### Model

- **Type:** offset / limit [DOCUMENTED]
- **Default page size:** 10 [DOCUMENTED]
- **Max page size:** endpoint-specific — users `500`, form-submissions `100`; no global max published [DOCUMENTED]
- **Total count available:** No — use the "fewer-than-limit" heuristic. [DOCUMENTED]

### Request Parameters

| Parameter | Type    | Default | Description       |
| --------- | ------- | ------- | ----------------- |
| limit     | integer | 10      | Items per page    |
| offset    | integer | 0       | Starting position |

### Response Structure

The response body is an object with a `data` wrapper containing the result array keyed by resource name
(e.g. `data.users`, `data.shifts`, `data.formSubmissions`). A `requestId` and a `paging` echo are
**likely but not shown verbatim** in the docs.

```json
{
  "requestId": "req_8f3c1a",
  "data": {
    "users": [
      /* ... */
    ]
  },
  "paging": { "limit": 100, "offset": 0 }
}
```

[DOCUMENTED — `data.{resource}` nesting confirmed by the pagination guide; `requestId`/`paging` are [INFERRED].]

### Last Page Detection

> **Verbatim guidance:** "Continue incrementing `offset` by `limit` until the response returns fewer items
> than the limit, indicating you've reached the end." [DOCUMENTED]

There is **no** `Result-Total` / total-count field. Do not rely on a total.

### Full Pagination Loop

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items  (full page → continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items  (full page → continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items  (< limit → LAST PAGE, stop)
```

### Per-endpoint page-size caps

| Endpoint                                    | Max `limit` | Source                        |
| ------------------------------------------- | ----------- | ----------------------------- |
| `/users/v1/users`                           | 500         | [DOCUMENTED]                  |
| `/forms/v1/forms/{formId}/form-submissions` | 100         | [DOCUMENTED]                  |
| others (schedulers, shifts, time-clocks)    | [UNKNOWN]   | default to 100 conservatively |

---

## Bulk Reads & Large Datasets

- **No dedicated async export** endpoint. Auto-assign is the only async/polling pattern
  (`POST …/shifts/auto-assign` → `GET …/shifts/auto-assign/{requestId}`). [DOCUMENTED]
- **Rate-limit budgeting matters:** limits are **per account**, shared across all API clients. On
  Enterprise that's 200/min — a full user export at `limit=500` is a handful of calls, but interleave
  it with other activity. Cache list reads ~5 min. [DOCUMENTED]
- **Form-submission PDF retrieval** is referenced in the forum but undocumented. [INFERRED]

---

## Gotchas & Counter-Exceptions

1. **No total count.** The "fewer-than-limit" heuristic is the only documented last-page signal. [DOCUMENTED]
2. **Default `limit` is just 10.** Always set `limit` explicitly (100 default; up to the endpoint cap). [DOCUMENTED]
3. **Form-submissions cap at 100, not 500.** Don't reuse the users cap. [DOCUMENTED]
4. **92-day window on time activities.** A wider range is rejected — chunk it. [DOCUMENTED]
5. **Per-account rate limits are shared.** Multiple integrations + this connector compete for the same minute/day budget. [DOCUMENTED]
6. **Epoch seconds everywhere.** Convert ISO/ms to Unix seconds before filtering. [DOCUMENTED]
7. **No field selection / no `include`.** You get the full schema; fetch child resources separately. [INFERRED]

---

_Generated from the investigation questionnaire, Phases 5-6. Shared verbatim with the `connecteam-api` connector._
