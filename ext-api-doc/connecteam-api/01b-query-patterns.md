---
api_name: Connecteam (API Key)
api_slug: connecteam-api
base_url: https://api.connecteam.com
call_surface: HTTP via `numa integrations request`
auth: X-API-KEY header
companions: 01=api-rules, 01a=domain-model, 01c=mutation-patterns, 01d=events+errors
shared_api: query behaviour identical to connecteam-oauth — only auth header differs; keep in sync
confidence: [DOCUMENTED] from vendor docs unless tagged [INFERRED]/[UNKNOWN]; NO live call made
---

# Connecteam (API Key) — Query Patterns Reference

Read patterns: filtering, search, sorting, pagination, bulk reads. Companion to `01-llm-api-rules.md`.

## Query Capabilities

| Capability                      | Supported          | Syntax                                                                  | Notes                               |
| ------------------------------- | ------------------ | ----------------------------------------------------------------------- | ----------------------------------- |
| Filter by field value           | Yes (per-endpoint) | `?userStatus=active`, `?jobCodes=DD-001`                                | Whitelisted params only             |
| Filter by id list               | Yes                | `?userIds=1&userIds=2` (repeated param)                                 | Exact-match arrays                  |
| Filter by date/time range       | Yes                | `?startDate=&endDate=` (YYYY-MM-DD) or `?startTime=&endTime=` (epoch s) | per endpoint                        |
| Filter "modified since"         | Yes                | `?modifiedAt={epoch_s}` (users)                                         | Polling-friendly                    |
| Full-text search                | No                 | —                                                                       | Exact-match filters only [INFERRED] |
| Sort by field                   | Limited            | `?sort=created_at` / `?sort=title`                                      | small per-endpoint allow-list       |
| Sort direction                  | Yes                | `?order=asc` / `?order=desc`                                            | default `asc`                       |
| Field selection / sparse fields | No                 | —                                                                       | [INFERRED]                          |
| Include related records         | No                 | —                                                                       | Use child endpoints [INFERRED]      |
| Include deleted/archived        | Partial            | `?includeDeleted=true` (jobs); archived clocks always listed            |                                     |
| Aggregate / count               | Partial            | Timesheet endpoint aggregates hours                                     | No generic total-count              |
| Logical AND                     | Yes                | Multiple params AND-combined                                            | [INFERRED]                          |
| Logical OR                      | No                 | —                                                                       | [INFERRED]                          |
| Comparison operators (gt/lt)    | No                 | Use explicit from/to params                                             | [INFERRED]                          |

## Filter Syntax

Whitelisted query-string params per endpoint.

```
GET /users/v1/users?userStatus=archived&order=desc&limit=100
GET /jobs/v1/jobs?jobCodes=DD-001&includeDeleted=false&sort=title&order=asc
GET /time_clock/v1/time_clocks/{id}/time_activities?startDate=2025-01-01&endDate=2025-03-01&userIds=9170357&activityTypes=shift
GET /scheduler/v2/schedulers/{id}/shifts?startTime=1736900000&endTime=1737500000&isPublished=true
```

- Array filters use **repeated query params** (`?userIds=1&userIds=2`) [INFERRED — common REST pattern; confirm in discovery].
- Multiple distinct filters combine with **implicit AND**. No OR, nesting, or comparison operators — use explicit from/to params for ranges [INFERRED].

### Users list — full filter set

| Parameter      | Type              | Default  | Description                          |
| -------------- | ----------------- | -------- | ------------------------------------ |
| limit          | integer (1–500)   | 10       | Page size                            |
| offset         | integer (≥0)      | 0        | Start position                       |
| sort           | string            | —        | Allowed: `created_at`                |
| order          | enum              | `asc`    | `asc`/`desc`                         |
| userIds        | array<int>        | —        | Specific user ids                    |
| userStatus     | enum              | `active` | `active`/`archived` (likely `all`)   |
| fullNames      | array<string>     | —        | Exact, **case-sensitive** name match |
| phoneNumbers   | array<string>     | —        | E.164 phone match                    |
| emailAddresses | array<string>     | —        | Email match                          |
| createdAt      | integer (epoch s) | —        | Users created after timestamp        |
| modifiedAt     | integer (epoch s) | —        | Users modified after timestamp       |

### Jobs list — filter set

`instanceIds[]`, `jobIds[]`, `jobNames[]`, `jobCodes[]`, `includeDeleted` (bool), `sort` (`title`), `order` (`asc`/`desc`), `limit` (default 10, max 500), `offset`.

### Time activities — filter set

`startDate`, `endDate` (**required**, `YYYY-MM-DD`, range ≤92 days), `userIds[]`, `jobIds[]`, `manualBreakIds[]`, `policyTypeIds[]`, `activityTypes[]` (`shift`/`manual_break`/`time_off`).

### Shifts — filter set

`startTime`, `endTime` (**required**, epoch s), `jobId[]`, `assignedUserIds[]`, `isOpenShift` (bool), `isPublished` (bool), `limit` (default 10, max 500), `offset`.

### Gotchas

- **Array params exact-match only** (`userIds`, `fullNames`, `phoneNumbers`, `jobCodes`). `fullNames` is **case-sensitive exact match**. No partial/fuzzy matching.
- **Mixed time formats:** time-activities use `YYYY-MM-DD` date strings; shifts use **epoch-second** `startTime`/`endTime`; users' `createdAt`/`modifiedAt` filters are epoch seconds.
- **Time-activity windows capped at 92 days** — split wider ranges into ≤90-day chunks.
- **`sort` is a tiny allow-list** (`created_at` for users, `title` for jobs). Other endpoints' sort support undocumented — assume server-default ordering; don't assume arbitrary sort keys.

## Search Capabilities

- **No global search endpoint** [INFERRED].
- **Per-resource lookups:** exact-match filters only — id/name/phone/email arrays for users; `jobNames`/`jobCodes` for jobs.
- **No fuzzy/wildcard matching** [INFERRED].
- **To "search" a user by name:** pass full name(s) to `fullNames` (case-sensitive exact), or list all and filter client-side.

## Field Selection

Not supported — endpoints return their full documented schema. No `columns`/`fields`/`include` param [INFERRED].

## Common Patterns

```http
# Pattern 1: All active employees (paginated)
GET /users/v1/users?userStatus=active&sort=created_at&order=desc&limit=200&offset=0

# Pattern 2: Time activities for a clock over a month (within the 92-day cap)
GET /time_clock/v1/time_clocks/12345/time_activities?startDate=2025-04-01&endDate=2025-04-30

# Pattern 3: Published shifts for a scheduler this week (V2)
GET /scheduler/v2/schedulers/6833518/shifts?startTime=1745020800&endTime=1745625600&isPublished=true

# Pattern 4: Users changed since last sync (polling — returns users modified at/after the epoch-second ts; recommended in place of a change feed)
GET /users/v1/users?modifiedAt=1745000000&order=desc&limit=200

# Pattern 5: Get a single user by id  [INFERRED — by-id route from REST convention; verify live]
GET /users/v1/users/7031021

# Pattern 6: Form submissions in a date window for specific users (Enterprise plan; date-window param slugs [INFERRED])
GET /forms/v1/forms/555/form_submissions?userIds=9170357&limit=100&offset=0
```

All calls send `X-API-KEY: {api_token}` + `Host: api.connecteam.com`.

## Pagination Handling

- **Type:** offset/limit. **Default page size:** 10. **Max:** 500 (documented users+jobs; assume 500 elsewhere [INFERRED]).
- **No total count** — "fewer-than-limit" heuristic: increment `offset` by `limit` until the response returns **fewer items than the limit**. No total to rely on.

| Parameter | Type    | Default | Description       |
| --------- | ------- | ------- | ----------------- |
| limit     | integer | 10      | Items per page    |
| offset    | integer | 0       | Starting position |

### ⚠️ `paging` location is inconsistent

Top-level (users) vs nested under `data` (jobs/shifts). Parsers must check both. Result array keyed by resource name (`data.users`, `data.shifts`, `data.jobs`, `data.formSubmissions`).

```json
{"requestId":"req_8f3c1a","data":{"users":[]},"paging":{"offset":0}}              // users — top level
{"requestId":"abc123","data":{"paging":{"offset":100},"jobs":[]}}                  // jobs/shifts — nested
```

### Full Pagination Loop

```
Page 1: GET /users/v1/users?limit=500&offset=0    -> 500 items (full page → continue)
Page 2: GET /users/v1/users?limit=500&offset=500  -> 500 items (full page → continue)
Page 3: GET /users/v1/users?limit=500&offset=1000 -> 137 items (< limit → LAST PAGE, stop)
```

### Per-endpoint page-size caps

| Endpoint                                     | Max `limit` | Source                        |
| -------------------------------------------- | ----------- | ----------------------------- |
| `/users/v1/users`                            | 500         | [DOCUMENTED]                  |
| `/jobs/v1/jobs`                              | 500         | [DOCUMENTED]                  |
| `/scheduler/{v1\|v2}/schedulers/{id}/shifts` | 500         | [DOCUMENTED]                  |
| others (schedulers, time-clocks, forms)      | [UNKNOWN]   | default to 100 conservatively |

## Bulk Reads & Large Datasets

- **No dedicated async export.** Auto-assign is the only async/poll pattern (`POST …/shifts_auto_assign` → `GET …/shifts_auto_assign/{requestId}`).
- **Rate-limit budgeting:** limits **per account**, shared across all keys/clients. On Enterprise (200/min + 20k/day) a full user export at `limit=500` is a handful of calls; interleave with other activity and mind the **day-level** cap when paging. Cache list reads ~5 min.

## Gotchas (dedup of the above — quick scan)

1. No total count — "fewer-than-limit" is the only last-page signal.
2. Default `limit` is just 10 — always set it explicitly.
3. `paging` lives in two places (top-level users; nested jobs/shifts).
4. 92-day window on time activities — chunk wider ranges.
5. Per-account rate limits are shared across integrations.
6. Mixed time formats — date-string on time-activities, epoch-second on shifts/users.
7. No field selection / no `include` [INFERRED].
8. Scheduler shifts have V1 and V2 — default to V2; both return hex-string shift ids.
