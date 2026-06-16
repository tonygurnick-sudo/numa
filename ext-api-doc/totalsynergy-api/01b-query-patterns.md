---
api_name: Total Synergy (API Key)
api_slug: totalsynergy-api
companion_to: 01-llm-api-rules.md
sibling: totalsynergy-oauth — identical query surface (same criteria.* params + envelope); only credential differs.
confidence: criteria.Id + criteria.pagesize are [DOCUMENTED]. Rest of criteria.* (page-index name, date filters, sort) is [INFERRED]/[UNKNOWN]. NO live call made. 🔬 = confirm on a live tenant. Every read = one of your 300 daily calls — query frugally.
---

# Total Synergy (API Key) — Query Patterns Reference

Read operations: filtering, the `criteria.*` family, pagination, recipes. All calls use HTTP via `numa integrations request` with the `access-token: <apiKey>` header — NOT a file-browse connector.

## Query capabilities summary

| Capability                 | Supported      | Syntax                              | Notes                                                       | Confidence    |
| -------------------------- | -------------- | ----------------------------------- | ----------------------------------------------------------- | ------------- |
| Filter by id               | Yes            | `?criteria.Id={id}`                 | Returns the single matching record (still in list envelope) | [DOCUMENTED]  |
| Page size                  | Yes            | `?criteria.pagesize={n}` (max 1000) | Always send explicitly                                      | [DOCUMENTED]  |
| Page index / offset        | Likely         | `?criteria.page={n}` (name 🔬)      | Param name unconfirmed                                      | [INFERRED] 🔬 |
| Keyset pagination          | Yes (some EPs) | endpoint-specific                   | Don't assume `pagesize` works on these                      | [DOCUMENTED]  |
| Filter by other fields     | Likely         | additional `criteria.*` params      | Family unknown                                              | [INFERRED] 🔬 |
| Date-range filter          | Likely         | `criteria.*Date*` / `*AsInt`        | e.g. `fromDateAsInt`/`toDateAsInt`                          | [INFERRED] 🔬 |
| Full-text search           | Unknown        | 🔬                                  | No search endpoint confirmed                                | [UNKNOWN]     |
| Sort by field / direction  | Unknown        | 🔬                                  | No sort param confirmed                                     | [UNKNOWN]     |
| Field selection / sparse   | Unknown        | 🔬                                  | Not confirmed                                               | [UNKNOWN]     |
| Include related records    | Unknown        | 🔬                                  | No `expand`/`include` confirmed                             | [UNKNOWN]     |
| Logical operators (AND/OR) | Unknown        | 🔬                                  | Assume implicit AND across `criteria.*` 🔬                  | [INFERRED] 🔬 |

## The `criteria.*` parameter family

All filtering uses dotted query params prefixed `criteria.`:
`GET /api/v2/Organisation/{Slug}/{Resource}?criteria.Id=123&criteria.pagesize=200`

- `criteria.Id` — fetch the single record with that id. [DOCUMENTED]
- `criteria.pagesize` — items per page, **max 1000**. [DOCUMENTED]
- `criteria.page` — page index (**name unconfirmed** 🔬). [INFERRED]

> 🔬 **DISCOVER:** the complete `criteria.*` family is the single biggest query gap. Dump `/swagger/ui/index` (v2) with a live key to enumerate every filter, the real page-index param, and whether AND/OR/sort are supported. Do NOT invent `criteria.*` params.

## Pagination

- Offset/page via `criteria.pagesize` (+ page index). Envelope `{ "totalItems": <int>, "items": [ … ] }` — `totalItems` is the total count. [DOCUMENTED]
- **No documented default page size** — always send `criteria.pagesize` 🔬. Max **1000** (non-keyset). [DOCUMENTED/UNKNOWN]
- Page index param `criteria.page`, default 1, **name unconfirmed** 🔬. [INFERRED]
- **Last page:** `(page * pagesize) >= totalItems`, or `items.length < pagesize`.
- **Keyset endpoints** exist but are unidentified 🔬 — don't assume `pagesize` works on every endpoint. If a list ignores `pagesize` or returns a cursor field, follow its cursor instead. [DOCUMENTED]
- ⚠️ **Each page = one of your 300 daily calls** (per-org, shared across keys). Use `pagesize=1000` to minimise pages; read `totalItems` on page 1 and decide if a full scan is worth the budget; cache for the session — never re-scan to "refresh" casually.

How to paginate:

```
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000              # page 1
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000&criteria.page=2   # page 2 🔬 (param name unconfirmed)
```

## Common patterns

**Resolve the org slug (do first):** `GET /api/v2/Organisation/MySlug` → `{"slug":"acme-eng","name":"Acme Engineering"}`. Exact path/shape 🔬 (may return a list). Cache `{Slug}` for the session; don't re-resolve per call.

**Get by id** (returns the list envelope — read `items[0]`):
`GET /api/v2/Organisation/{Slug}/Projects?criteria.Id=10042` → `{"totalItems":1,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active"}]}`

**List & page:**
`GET /api/v2/Organisation/{Slug}/Contacts?criteria.pagesize=1000` → `{"totalItems":1840,"items":[{"id":"551","name":"Riverside Council","email":"info@riverside.gov"}]}`. Pages to expect = `ceil(totalItems / pagesize)`.

**Read timesheets for a week:**
`GET /api/v2/Organisation/{Slug}/Timesheet/Week?fromDateAsInt=20260526&staffId=88`. Path `Timesheet/Week` is [DOCUMENTED]; query params (`fromDateAsInt`/week-start, `staffId`) + response shape are [INFERRED] 🔬 — confirm real param names on the spec.

**Search by name (no full-text search confirmed):** There is **no confirmed full-text search endpoint** 🔬. To find a record by name, page the list (`?criteria.pagesize=1000`) and filter `items[]` client-side, or use `criteria.Id` if you have the id. Don't assume a text filter exists — paging + client-side filter is the safe fallback (mind the daily budget).

## Worked examples

**1. Find a project by id and read its status:**
`GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042` → `{"totalItems":1,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active","clientId":"551"}]}`. Id filter returns the list envelope — read `items[0]`. Field names [INFERRED] 🔬.

**2. Page through all staff (resolve ids for a timesheet write):**
`GET /api/v2/Organisation/acme-eng/Staff?criteria.pagesize=1000` → `{"totalItems":24,"items":[{"id":"88","name":"Jordan Lee","email":"jordan@acme-eng.com"},{"id":"91","name":"Priya Nair","email":"priya@acme-eng.com"}]}`. 24 < 1000 → `items.length < pagesize` → done in one call. Use the returned `id` as `staffId` for Transaction writes.

**3. Two-page contact scan:**

```
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000              # page 1: items 1–1000
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000&criteria.page=2   # page 2: items 1001–1840 🔬
```

`totalItems=1840`, `pagesize=1000` → 2 pages. Page 2 returns 840 (`< 1000`) → last page. Page-index param `criteria.page` [INFERRED] 🔬. **This scan costs 2 of your 300 daily calls.**

## Gotchas

1. **No `Authorization: Bearer`** — reads use the `access-token` header (same as writes). A `Bearer` (or `X-API-Key`) header → 401. [DOCUMENTED]
2. **Call `api.totalsynergy.com`, never the registry `instance_url`** — the org `{Slug}` is a path value. [DOCUMENTED] 🚩
3. **Id filtering still returns the list envelope** (`{totalItems, items[]}`) — read `items[0]`. [DOCUMENTED]
4. **No default page size** — omitting `criteria.pagesize` is undefined; always send it. [UNKNOWN] 🔬
5. **Keyset endpoints exist** and won't honour `pagesize` — detect and follow their cursor. [DOCUMENTED]
6. **No confirmed full-text search or sort** — page + client-side filter is the fallback. Don't invent `criteria.*` filters. [UNKNOWN] 🔬
7. **Every page burns daily budget** — the 300/day per-org cap makes large scans expensive. Prefer `criteria.Id` lookups over scans whenever you have an id. [DOCUMENTED]
