---
api_name: 'Connecteam (API Key)'
api_slug: 'connecteam-api'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Connecteam (API Key) -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. All read patterns: filtering, search, sorting, pagination, bulk reads.
>
> **Shared API:** identical to the `connecteam-oauth` connector — **only auth differs**. Every example
> here is the same call; just swap `Authorization: Bearer {token}` for `X-API-KEY: {api_token}`.

---

## Query Capabilities Summary

| Capability                      | Supported          | Syntax                                                                  | Notes                                      |
| ------------------------------- | ------------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| Filter by field value           | Yes (per-endpoint) | `?userStatus=active`, `?jobCodes=DD-001`                                | Whitelisted params only [DOCUMENTED]       |
| Filter by id list               | Yes                | `?userIds=1&userIds=2` (repeated param)                                 | Exact-match arrays [DOCUMENTED]            |
| Filter by date/time range       | Yes                | `?startDate=&endDate=` (YYYY-MM-DD) or `?startTime=&endTime=` (epoch s) | per endpoint [DOCUMENTED]                  |
| Filter "modified since"         | Yes                | `?modifiedAt={epoch_s}` (users)                                         | Polling-friendly [DOCUMENTED]              |
| Full-text search                | No                 | —                                                                       | Exact-match filters only [INFERRED]        |
| Sort by field                   | Limited            | `?sort=created_at` / `?sort=title`                                      | small per-endpoint allow-list [DOCUMENTED] |
| Sort direction                  | Yes                | `?order=asc` / `?order=desc`                                            | default `asc` [DOCUMENTED]                 |
| Field selection / sparse fields | No                 | —                                                                       | Not documented [INFERRED]                  |
| Include related records         | No                 | —                                                                       | Use child endpoints instead [INFERRED]     |
| Include deleted/archived        | Partial            | `?includeDeleted=true` (jobs); archived clocks always listed            | [DOCUMENTED]                               |
| Aggregate / count               | Partial            | Timesheet endpoint aggregates hours                                     | No generic total-count [DOCUMENTED]        |
| Logical operators (AND)         | Yes                | Multiple params AND-combined                                            | [INFERRED]                                 |
| Logical operators (OR)          | No                 | —                                                                       | [INFERRED]                                 |
| Comparison operators (gt/lt)    | No                 | Use explicit from/to params instead                                     | [INFERRED]                                 |

---

## Filter Syntax

### General pattern — whitelisted query-string params per endpoint

```
GET /users/v1/users?userStatus=archived&order=desc&limit=100
GET /jobs/v1/jobs?jobCodes=DD-001&includeDeleted=false&sort=title&order=asc
GET /time_clock/v1/time_clocks/{id}/time_activities?startDate=2025-01-01&endDate=2025-03-01&userIds=9170357&activityTypes=shift
GET /scheduler/v2/schedulers/{id}/shifts?startTime=1736900000&endTime=1737500000&isPublished=true
```

- **Array filters use repeated query params** (`?userIds=1&userIds=2`). [INFERRED — common REST pattern; confirm in discovery]
- Multiple distinct filters combine with **implicit AND**. No OR, no nesting, no comparison operators — use explicit from/to params for ranges. [INFERRED]

### Users list — full filter set [DOCUMENTED]

| Parameter      | Type              | Default  | Description                          |
| -------------- | ----------------- | -------- | ------------------------------------ |
| limit          | integer (1–500)   | 10       | Page size                            |
| offset         | integer (≥0)      | 0        | Start position                       |
| sort           | string            | —        | Allowed: `created_at`                |
| order          | enum              | `asc`    | `asc` / `desc`                       |
| userIds        | array<int>        | —        | Specific user ids                    |
| userStatus     | enum              | `active` | `active` / `archived` (likely `all`) |
| fullNames      | array<string>     | —        | Exact, case-sensitive name match     |
| phoneNumbers   | array<string>     | —        | E.164 phone match                    |
| emailAddresses | array<string>     | —        | Email match                          |
| createdAt      | integer (epoch s) | —        | Users created after timestamp        |
| modifiedAt     | integer (epoch s) | —        | Users modified after timestamp       |

### Jobs list — filter set [DOCUMENTED]

`instanceIds[]`, `jobIds[]`, `jobNames[]`, `jobCodes[]`, `includeDeleted` (bool), `sort` (`title`), `order` (`asc`/`desc`), `limit` (default 10, max 500), `offset`.

### Time activities — filter set [DOCUMENTED]

`startDate`, `endDate` (**required**, `YYYY-MM-DD`, range ≤ 92 days), `userIds[]`, `jobIds[]`, `manualBreakIds[]`, `policyTypeIds[]`, `activityTypes[]` (`shift`/`manual_break`/`time_off`).

### Shifts — filter set [DOCUMENTED]

`startTime`, `endTime` (**required**, epoch s), `jobId[]`, `assignedUserIds[]`, `isOpenShift` (bool), `isPublished` (bool), `limit` (default 10, max 500), `offset`.

### Gotchas

- **Array params are exact-match only** (`userIds`, `fullNames`, `phoneNumbers`, `jobCodes`). `fullNames` is **case-sensitive exact match**. No partial/fuzzy matching. [DOCUMENTED]
- **Mixed time formats:** time-activities use `YYYY-MM-DD` date strings; shifts use **epoch-second** `startTime`/`endTime`; users' `createdAt`/`modifiedAt` filters are epoch seconds. [DOCUMENTED]
- **Time-activity windows are capped at 92 days** — split wider ranges into ≤ 90-day chunks. [DOCUMENTED]
- **`sort` is a tiny allow-list** (`created_at` for users, `title` for jobs). Don't assume arbitrary sort keys. [DOCUMENTED]

---

## Sort Syntax

```
?sort=created_at&order=desc   (users)
?sort=title&order=asc         (jobs)
```

Only a small per-endpoint allow-list is supported; other endpoints' sort support is undocumented — assume server-default ordering. [DOCUMENTED / INFERRED]

---

## Field Selection

Not supported — endpoints return their full documented schema. There is no `columns`/`fields`/`include` param. [INFERRED]

---

## Search Capabilities

- **Global search endpoint:** none. [INFERRED]
- **Per-resource lookups:** exact-match filters only — id/name/phone/email arrays for users; `jobNames`/`jobCodes` for jobs. [DOCUMENTED]
- **Fuzzy / wildcard matching:** not supported. [INFERRED]
- **To "search" a user by name:** pass the full name(s) to `fullNames` (case-sensitive exact), or list all and filter client-side. [DOCUMENTED]

---

## Common Patterns

### Pattern 1: All active employees (paginated)

```http
GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=200&offset=0
Host: api.connecteam.com
X-API-KEY: {api_token}
```

### Pattern 2: Time activities for a clock over a month (within the 92-day cap)

```http
GET /time_clock/v1/time_clocks/12345/time_activities?startDate=2025-04-01&endDate=2025-04-30
Host: api.connecteam.com
X-API-KEY: {api_token}
```

### Pattern 3: Published shifts for a scheduler this week (V2)

```http
GET /scheduler/v2/schedulers/6833518/shifts?startTime=1745020800&endTime=1745625600&isPublished=true
Host: api.connecteam.com
X-API-KEY: {api_token}
```

### Pattern 4: Users changed since last sync (polling)

```http
GET /users/v1/users?modifiedAt=1745000000&order=desc&limit=200
Host: api.connecteam.com
X-API-KEY: {api_token}
```

Returns users modified at/after the epoch-second timestamp — the recommended polling pattern in place of a change feed. [DOCUMENTED]

### Pattern 5: Get a single user by id

```http
GET /users/v1/users/7031021
Host: api.connecteam.com
X-API-KEY: {api_token}
```

[INFERRED — by-id route deduced from REST convention; verify against a live call.]

### Pattern 6: Form submissions in a date window for specific users (Enterprise plan)

```http
GET /forms/v1/forms/555/form_submissions?userIds=9170357&limit=100&offset=0
Host: api.connecteam.com
X-API-KEY: {api_token}
```

> Forms API requires the **Enterprise** plan. The exact date-window param slugs on form_submissions are
> [INFERRED] — confirm against a live call.

---

## Pagination Handling

### Model

- **Type:** offset / limit [DOCUMENTED]
- **Default page size:** 10 [DOCUMENTED]
- **Max page size:** 500 (documented on users + jobs; assume 500 elsewhere). [DOCUMENTED / INFERRED]
- **Total count available:** No — use the "fewer-than-limit" heuristic. [DOCUMENTED]

### Request Parameters

| Parameter | Type    | Default | Description       |
| --------- | ------- | ------- | ----------------- |
| limit     | integer | 10      | Items per page    |
| offset    | integer | 0       | Starting position |

### Response Structure — ⚠️ `paging` location is inconsistent

Some endpoints place `paging` at the **top level** (users); others **nest it under `data`** (jobs/shifts).
Parsers must check both locations. [DOCUMENTED]

```json
// users — paging at top level
{ "requestId": "req_8f3c1a", "data": { "users": [ /* ... */ ] }, "paging": { "offset": 0 } }

// jobs / shifts — paging nested under data
{ "requestId": "abc123", "data": { "paging": { "offset": 100 }, "jobs": [ /* ... */ ] } }
```

The result array is keyed by resource name (`data.users`, `data.shifts`, `data.jobs`, `data.formSubmissions`). [DOCUMENTED]

### Last Page Detection

> **Verbatim guidance:** continue incrementing `offset` by `limit` until the response returns **fewer items
> than the limit**, indicating you've reached the end. [DOCUMENTED]

There is **no** total-count field. Do not rely on a total.

### Full Pagination Loop

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items  (full page → continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items  (full page → continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items  (< limit → LAST PAGE, stop)
```

### Per-endpoint page-size caps

| Endpoint                                     | Max `limit` | Source                        |
| -------------------------------------------- | ----------- | ----------------------------- |
| `/users/v1/users`                            | 500         | [DOCUMENTED]                  |
| `/jobs/v1/jobs`                              | 500         | [DOCUMENTED]                  |
| `/scheduler/{v1\|v2}/schedulers/{id}/shifts` | 500         | [DOCUMENTED]                  |
| others (schedulers, time-clocks, forms)      | [UNKNOWN]   | default to 100 conservatively |

---

## Bulk Reads & Large Datasets

- **No dedicated async export** endpoint. Auto-assign is the only async/poll pattern
  (`POST …/shifts_auto_assign` → `GET …/shifts_auto_assign/{requestId}`). [DOCUMENTED]
- **Rate-limit budgeting matters:** limits are **per account**, shared across all keys/clients. On
  Enterprise that's 200/min + 20k/day — a full user export at `limit=500` is a handful of calls, but
  interleave it with other activity. Mind the **day-level** cap when paging large datasets. Cache list
  reads ~5 min. [DOCUMENTED]

---

## Gotchas & Counter-Exceptions

1. **No total count.** The "fewer-than-limit" heuristic is the only documented last-page signal. [DOCUMENTED]
2. **Default `limit` is just 10.** Always set `limit` explicitly. [DOCUMENTED]
3. **`paging` lives in two places.** Top-level for users; nested under `data` for jobs/shifts. Check both. [DOCUMENTED]
4. **92-day window on time activities.** A wider range is rejected — chunk it. [DOCUMENTED]
5. **Per-account rate limits are shared.** Multiple integrations + this connector compete for the same minute/day budget. [DOCUMENTED]
6. **Mixed time formats:** date-string filters on time-activities, epoch-second on shifts/users. Convert before filtering. [DOCUMENTED]
7. **No field selection / no `include`.** You get the full schema; fetch child resources separately. [INFERRED]
8. **Scheduler shifts have V1 and V2.** Default to V2; both return hex-string shift ids. [DOCUMENTED]

---

_Generated from the investigation questionnaire, Phases 5-6. Query behaviour shared verbatim with the
`connecteam-oauth` connector — only the auth header differs._
