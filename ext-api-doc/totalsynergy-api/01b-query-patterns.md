---
api_name: 'Total Synergy (API Key)'
api_slug: 'totalsynergy-api'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Total Synergy (API Key) — Query Patterns Reference

> Companion to `01-llm-api-rules.md`. All read operation patterns: filtering, the `criteria.*`
> family, pagination, and common recipes.
>
> 📌 **Same query surface as `totalsynergy-oauth`** — identical `criteria.*` params, identical
> envelope. Only the credential differs (the static key is sent in the same `access-token` header).
>
> ⚠️ **Confidence:** `criteria.Id` and `criteria.pagesize` are `[DOCUMENTED]`. The rest of the
> `criteria.*` family (page-index name, date filters, sort) is `[INFERRED]`/`[UNKNOWN]` — the
> reference is a JS-rendered Swagger SPA that could not be enumerated, and **no live call was made**.
> Items tagged **🔬** must be confirmed against a live tenant. **Every read is one of your 300
> daily calls — query frugally.**

---

## Query Capabilities Summary

| Capability                 | Supported      | Syntax                              | Notes                                      | Confidence    |
| -------------------------- | -------------- | ----------------------------------- | ------------------------------------------ | ------------- |
| Filter by id               | Yes            | `?criteria.Id={id}`                 | Returns the single matching record         | [DOCUMENTED]  |
| Page size                  | Yes            | `?criteria.pagesize={n}` (max 1000) | Always send explicitly                     | [DOCUMENTED]  |
| Page index / offset        | Likely         | `?criteria.page={n}` (name 🔬)      | Page-index param name unconfirmed          | [INFERRED] 🔬 |
| Keyset pagination          | Yes (some EPs) | endpoint-specific; not detailed     | Don't assume `pagesize` works on these     | [DOCUMENTED]  |
| Filter by other fields     | Likely         | additional `criteria.*` params      | Family unknown                             | [INFERRED] 🔬 |
| Date-range filter          | Likely         | `criteria.*Date*` / `*AsInt`        | e.g. `fromDateAsInt` / `toDateAsInt`       | [INFERRED] 🔬 |
| Full-text search           | Unknown        | 🔬                                  | No search endpoint confirmed               | [UNKNOWN]     |
| Sort by field / direction  | Unknown        | 🔬                                  | No sort param confirmed                    | [UNKNOWN]     |
| Field selection / sparse   | Unknown        | 🔬                                  | Not confirmed                              | [UNKNOWN]     |
| Include related records    | Unknown        | 🔬                                  | No `expand`/`include` confirmed            | [UNKNOWN]     |
| Logical operators (AND/OR) | Unknown        | 🔬                                  | Assume implicit AND across `criteria.*` 🔬 | [INFERRED] 🔬 |

---

## The `criteria.*` Parameter Family

All filtering observed in the docs uses dotted query params prefixed `criteria.`:

```
GET /api/v2/Organisation/{Slug}/{Resource}?criteria.Id=123&criteria.pagesize=200
```

- **`criteria.Id`** — fetch the single record with that id. `[DOCUMENTED]`
- **`criteria.pagesize`** — items per page, **max 1000**. `[DOCUMENTED]`
- **`criteria.page`** — page index (param **name unconfirmed** 🔬). `[INFERRED]`

> 🔬 **DISCOVER:** the complete `criteria.*` family is the single biggest query gap. Dump
> `/swagger/ui/index` (v2) with a live static key to enumerate every filter, the real page-index
> param, and whether AND/OR/sort are supported. Do **not** invent `criteria.*` params.

---

## Common Patterns

### Pattern 1: Get by ID

```http
GET /api/v2/Organisation/{Slug}/Projects?criteria.Id=10042
Host: api.totalsynergy.com
access-token: <apiKey>
```

```json
{ "totalItems": 1, "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active" }] }
```

> Note: id filtering still returns the **list envelope** (`totalItems` + `items[]`), not a bare
> object — read `items[0]`. `[DOCUMENTED]` (envelope) / `[INFERRED]` (fields) 🔬

---

### Pattern 2: List & Page

```http
GET /api/v2/Organisation/{Slug}/Contacts?criteria.pagesize=1000
Host: api.totalsynergy.com
access-token: <apiKey>
```

```json
{
  "totalItems": 1840,
  "items": [{ "id": "551", "name": "Riverside Council", "email": "info@riverside.gov" }]
}
```

- Use `criteria.pagesize=1000` to minimise the number of pages (each page = one daily call).
- `totalItems` tells you how many pages to expect: `ceil(totalItems / pagesize)`.

---

### Pattern 3: Resolve the org slug (do this first)

```http
GET /api/v2/Organisation/MySlug
Host: api.totalsynergy.com
access-token: <apiKey>
```

```json
{ "slug": "acme-eng", "name": "Acme Engineering" }
```

> Exact path + shape 🔬 — may be `GET /api/v2/Organisation` returning a list. Cache the resolved
> `{Slug}` for the session; don't re-resolve on every call (saves budget).

---

### Pattern 4: Read timesheets for a week

```http
GET /api/v2/Organisation/{Slug}/Timesheet/Week?fromDateAsInt=20260526&staffId=88
Host: api.totalsynergy.com
access-token: <apiKey>
```

> Query params (`fromDateAsInt`/week-start, `staffId`) and response shape are `[INFERRED]` 🔬 —
> confirm the real param names on the spec. The path `Timesheet/Week` is `[DOCUMENTED]`.

---

### Pattern 5: Search by criteria (no full-text search confirmed)

There is **no confirmed full-text search endpoint**. To find a record by name, you must page the
list and filter client-side, or use `criteria.Id` if you already have the id. `[UNKNOWN]` 🔬

```http
GET /api/v2/Organisation/{Slug}/Contacts?criteria.pagesize=1000
# then filter items[] by name in the agent
```

> 🔬 If a name/text filter exists in `criteria.*`, it must be discovered from the spec. Do not
> assume one — paging + client-side filter is the safe fallback (mind the daily budget).

---

## Pagination Handling

### Model

- **Type:** offset/page via `criteria.pagesize` (+ page index). **Keyset** on some (unidentified) endpoints. `[DOCUMENTED]`
- **Default page size:** **not documented** — always send `criteria.pagesize` explicitly. `[UNKNOWN]` 🔬
- **Max page size:** **1000** (non-keyset endpoints). `[DOCUMENTED]`
- **Total count:** `totalItems` in the response envelope. `[DOCUMENTED]`

### Request Parameters

| Parameter           | Type   | Default | Description                             | Confidence    |
| ------------------- | ------ | ------- | --------------------------------------- | ------------- |
| `criteria.pagesize` | int    | unknown | Items per page; **max 1000**            | [DOCUMENTED]  |
| `criteria.page`     | int    | 1 🔬    | Page index (param **name unconfirmed**) | [INFERRED] 🔬 |
| `criteria.Id`       | string | —       | Fetch a single record by id             | [DOCUMENTED]  |

### Response Structure

```json
{
  "totalItems": 312,
  "items": [
    /* … records … */
  ]
}
```

### How to Paginate

```http
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000              # page 1
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000&criteria.page=2   # page 2 🔬 (param name unconfirmed)
```

### Last-Page Detection

- `(page * pagesize) >= totalItems`, **or**
- `items.length < pagesize` (short page = last page). `[INFERRED]`

### Keyset Endpoints (caution)

Some endpoints use **keyset** pagination instead of `pagesize` — they exist but are **unidentified**
🔬. Do **not** assume `criteria.pagesize` works on every endpoint. If a list ignores `pagesize` or
returns a cursor field, switch to following its cursor. `[DOCUMENTED]`

### Budget Warning

⚠️ **Each page is one of your 300 daily calls** (and the cap is per-org, shared across keys). To
list a large resource:

1. Always use `criteria.pagesize=1000` to minimise page count.
2. Read `totalItems` on page 1 and decide whether a full scan is worth the budget.
3. Cache results for the session — never re-scan to "refresh" casually.

---

## Worked Examples

### Example 1: Find a project by id and read its status

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042
Host: api.totalsynergy.com
access-token: <apiKey>
```

```json
{
  "totalItems": 1,
  "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active", "clientId": "551" }]
}
```

**Key points:** id filter returns the list envelope — read `items[0]`. Field names `[INFERRED]` 🔬.

---

### Example 2: Page through all staff (resolve ids for a timesheet write)

```http
GET /api/v2/Organisation/acme-eng/Staff?criteria.pagesize=1000
Host: api.totalsynergy.com
access-token: <apiKey>
```

```json
{
  "totalItems": 24,
  "items": [
    { "id": "88", "name": "Jordan Lee", "email": "jordan@acme-eng.com" },
    { "id": "91", "name": "Priya Nair", "email": "priya@acme-eng.com" }
  ]
}
```

**Key points:** 24 staff fit on one page (`24 < 1000`), so `items.length < pagesize` → done in one
call. Use the returned `id` as `staffId` for Transaction writes.

---

### Example 3: Two-page contact scan

```http
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000              # page 1: items 1–1000
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000&criteria.page=2   # page 2: items 1001–1840 🔬
```

```json
{
  "totalItems": 1840,
  "items": [
    /* 1000 records */
  ]
}
```

**Key points:** `totalItems=1840`, `pagesize=1000` → 2 pages. Page 2 returns 840 records
(`< 1000`) → last page. The page-index param name (`criteria.page`) is `[INFERRED]` 🔬. **This scan
costs 2 of your 300 daily calls.**

---

## Gotchas & Counter-Exceptions

1. **No `Authorization: Bearer`.** Reads use the `access-token` header — same as writes. A `Bearer`
   header → 401. `[DOCUMENTED]`
2. **Call `api.totalsynergy.com`, never the registry `instance_url`.** The org `{Slug}` is a path
   value. `[DOCUMENTED]` 🚩
3. **Id filtering still returns the list envelope** (`totalItems` + `items[]`) — read `items[0]`.
   `[DOCUMENTED]`
4. **No default page size** — omitting `criteria.pagesize` has undefined behaviour; always send it.
   `[UNKNOWN]` 🔬
5. **Keyset endpoints exist** and won't honour `pagesize` — detect and follow their cursor instead.
   `[DOCUMENTED]`
6. **No confirmed full-text search or sort** — page + client-side filter is the fallback. Don't
   invent `criteria.*` filters. `[UNKNOWN]` 🔬
7. **Every page burns daily budget** — the 300/day (per-org) cap makes large scans expensive. Prefer
   `criteria.Id` lookups over scans whenever you have an id. `[DOCUMENTED]`

---

_Generated from the investigation questionnaire, Phases 5–6. Mirrors `totalsynergy-oauth` (same query surface)._
