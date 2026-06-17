---
api_name: Total Synergy (OAuth)
api_slug: totalsynergy-oauth
companion_to: 01-llm-api-rules.md
scope: read operations — listing, filtering by id, pagination
same_as: totalsynergy-api (identical access-token header, base URL, criteria.* convention, pagination envelope)
confidence: only `criteria.Id` and `criteria.pagesize` are [DOCUMENTED]. Rest of `criteria.*`, the page-index param name, sort syntax, and which endpoints are keyset are the LARGEST gap — items tagged 🔬 need a live tenant. When in doubt, page through and filter client-side.
budget: every list call = 1 of 300 daily requests (50/day Transactions). Use `criteria.pagesize=1000` to minimise pages; don't casually scan large resources.
---

# Total Synergy (OAuth) — Query Patterns Reference

## Capabilities

| Capability               | Supported      | Syntax                               | Confidence      |
| ------------------------ | -------------- | ------------------------------------ | --------------- |
| List a resource          | Yes            | `GET Organisation/{Slug}/{Resource}` | [DOCUMENTED]    |
| Filter by id             | Yes            | `?criteria.Id={id}`                  | [DOCUMENTED]    |
| Page size                | Yes            | `?criteria.pagesize={n}` (≤1000)     | [DOCUMENTED]    |
| Page index / offset      | Likely         | `?criteria.page={n}` (spelling 🔬)   | [INFERRED] 🔬   |
| Keyset pagination        | Yes (some EPs) | endpoint-specific; not detailed      | [DOCUMENTED] 🔬 |
| Filter by other fields   | Likely         | additional `criteria.*` params       | [INFERRED] 🔬   |
| Filter by date range     | Likely         | `criteria.*Date*` / `*AsInt`         | [INFERRED] 🔬   |
| Full-text search         | Unknown        | 🔬                                   | [UNKNOWN]       |
| Sort by field/direction  | Unknown        | 🔬                                   | [UNKNOWN]       |
| Field selection (sparse) | Unknown        | 🔬                                   | [UNKNOWN]       |
| Include related records  | Unknown        | 🔬                                   | [UNKNOWN]       |

## Patterns (all calls carry header `access-token: <token>`)

**1. List a resource** — `GET Organisation/acme-eng/Projects?criteria.pagesize=200`
→ paged envelope (flat `items[]` + `totalItems`): `{"totalItems":312,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active","clientId":"551"}]}`

**2. Get by ID** — there is **no `…/Projects/{id}` path**; filter the list by `criteria.Id` [DOCUMENTED]. `GET Organisation/acme-eng/Projects?criteria.Id=10042`
→ single record inside the same envelope (`totalItems:1`): `{"totalItems":1,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active"}]}`. Read `items[0]`.

**3. Resolve the org slug (prerequisite for everything)** — `GET Organisation/MySlug`
→ `{"slug":"acme-eng","name":"Acme Engineering"}`. Exact path (`/Organisation` list vs `/Organisation/MySlug`) + shape 🔬. The `{Slug}` returned is distinct from the `tenant` used at OAuth authorize time — you need the **slug** for resource paths.

**4. Get child records (project stages/tasks)** — `GET Organisation/acme-eng/Projects/10042/Stages`. Sub-resource path + envelope [INFERRED] 🔬. Used to resolve `stageId`/`taskId` before a timesheet write.

**5. Filter / date range (UNCONFIRMED)** — more `criteria.*` filters (+ integer-date ranges on timesheet endpoints) almost certainly exist but the full family is undocumented. Safe approach: page through and filter in the agent/client. To confirm on a live tenant: test `criteria.*` field equality, date-range params (`*AsInt`), and the page-index param name, then replace this with verified syntax 🔬.

**6. Resolve staff before a timesheet write** — `GET Organisation/acme-eng/Staff?criteria.pagesize=1000`
→ `{"totalItems":42,"items":[{"id":"88","name":"Sam Taylor"}]}`. Resolve a valid `staffId` here before posting to Transactions.

## Pagination

- Offset/page via `criteria.pagesize` (+ page index). **Keyset** on some endpoints (unidentified — don't assume `pagesize`/`page` work there) [DOCUMENTED] 🔬.
- No documented default size — **always send `criteria.pagesize` explicitly** [UNKNOWN] 🔬. Max **1000** (non-keyset) [DOCUMENTED]. Total count available via `totalItems` [DOCUMENTED].

| Parameter           | Type  | Description                          |
| ------------------- | ----- | ------------------------------------ |
| `criteria.pagesize` | int   | records per page (max 1000)          |
| `criteria.page`     | int   | page index — spelling unconfirmed 🔬 |
| `criteria.Id`       | mixed | filter to a single record id         |

Envelope: `{"totalItems":312,"items":[ … ]}`. Last page: `(page * pagesize) >= totalItems`, OR `items.length < pagesize` [INFERRED].

Loop:

```
page = 1
loop:
  GET Organisation/{Slug}/{Resource}?criteria.pagesize=1000&criteria.page={page}   # param name 🔬
  process response.items; fetched += response.items.length
  if fetched >= response.totalItems OR response.items.length < 1000: stop
  page += 1
```

⚠️ At 300/day, a resource over ~300k records can't be fully paged in a day at `pagesize=1000`. Prefer targeted `criteria.Id` reads over full scans.

## Gotchas

1. Token header is `access-token`, not `Authorization: Bearer` → 401 on every read.
2. Single fetch is a filtered list (`?criteria.Id=…`); there is no `…/{Resource}/{id}` path. Read `items[0]`.
3. Response is enveloped, not a bare array: read `response.items`, not `response[0]`.
4. `criteria.pagesize` over 1000 is rejected/clamped — never request more than 1000.
5. Keyset endpoints exist but are unidentified — `pagesize`/`page` may not work; confirm per endpoint 🔬.
6. Every read spends daily budget — no per-second limit to wait out; once 300 is hit, done for the day.
