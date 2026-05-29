---
api_name: 'Total Synergy (OAuth)'
api_slug: 'totalsynergy-oauth'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Total Synergy (OAuth) — Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read operations: listing, filtering by id, pagination.
>
> 📌 **Identical to `totalsynergy-api`** — only the credential differs; the `access-token` header,
> base URL, `criteria.*` query convention, and pagination envelope are the same.
>
> ⚠️ Only `criteria.Id` and `criteria.pagesize` are `[DOCUMENTED]`. The rest of the `criteria.*`
> filter family, the page-index parameter name, sort syntax, and which endpoints are keyset are the
> **largest documentation gap** — items tagged 🔬 must be confirmed against a live tenant. When in
> doubt, page through and filter **client-side**.
>
> 🪫 **Budget reminder:** every list call is one of your **300 daily** requests (50/day for
> Transactions). Use `criteria.pagesize=1000` to minimise pages; do not casually scan large resources.

---

## Query Capabilities Summary

| Capability                | Supported      | Syntax                                   | Confidence      |
| ------------------------- | -------------- | ---------------------------------------- | --------------- |
| List a resource           | Yes            | `GET …/Organisation/{Slug}/{Resource}`   | [DOCUMENTED]    |
| Filter by id              | Yes            | `?criteria.Id={id}`                      | [DOCUMENTED]    |
| Page size                 | Yes            | `?criteria.pagesize={n}` (≤ 1000)        | [DOCUMENTED]    |
| Page index / offset       | Likely         | `?criteria.page={n}` (param spelling 🔬) | [INFERRED] 🔬   |
| Keyset pagination         | Yes (some EPs) | endpoint-specific; not detailed          | [DOCUMENTED] 🔬 |
| Filter by other fields    | Likely         | additional `criteria.*` params           | [INFERRED] 🔬   |
| Filter by date range      | Likely         | `criteria.*Date*` / `*AsInt`             | [INFERRED] 🔬   |
| Full-text search          | Unknown        | 🔬                                       | [UNKNOWN]       |
| Sort by field / direction | Unknown        | 🔬                                       | [UNKNOWN]       |
| Field selection (sparse)  | Unknown        | 🔬                                       | [UNKNOWN]       |
| Include related records   | Unknown        | 🔬                                       | [UNKNOWN]       |

---

## Common Patterns

### Pattern 1: List a resource

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.pagesize=200
Host: api.totalsynergy.com
access-token: <accessToken>
```

Response is a **paged envelope** — a flat `items[]` array plus a `totalItems` count:

```json
{
  "totalItems": 312,
  "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active", "clientId": "551" }]
}
```

### Pattern 2: Get by ID (via `criteria.Id`)

> There is **no `…/Projects/{id}` path** for single fetch — filter the list by `criteria.Id`. `[DOCUMENTED]`

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042
Host: api.totalsynergy.com
access-token: <accessToken>
```

```json
{ "totalItems": 1, "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active" }] }
```

- Returns the single matching record inside the same `items[]` envelope (`totalItems: 1`).

### Pattern 3: Resolve the org slug (prerequisite for everything)

```http
GET /api/v2/Organisation/MySlug
Host: api.totalsynergy.com
access-token: <accessToken>
```

```json
{ "slug": "acme-eng", "name": "Acme Engineering" }
```

> Exact path (`/Organisation` list vs. `/Organisation/MySlug`) + shape 🔬. The `{Slug}` returned is
> distinct from the `tenant` used at OAuth authorize time — you need the **slug** for resource paths.

### Pattern 4: Get related child records (project stages/tasks)

```http
GET /api/v2/Organisation/acme-eng/Projects/10042/Stages
Host: api.totalsynergy.com
access-token: <accessToken>
```

> Sub-resource path + envelope are `[INFERRED]` 🔬. Used to resolve `stageId` / `taskId` before a timesheet write.

### Pattern 5: Filter / date range (UNCONFIRMED)

Total Synergy almost certainly supports more `criteria.*` filters (and integer-date ranges on
timesheet endpoints), but the full family is undocumented. Until confirmed:

- **Preferred safe approach:** page through the resource and filter in the agent/client.
- **If confirming on a live tenant:** test `criteria.*` field equality, date-range params
  (`*AsInt`), and the page-index param name, then replace this section with verified syntax. 🔬

---

## Pagination Handling

### Model

- **Type:** offset/page via `criteria.pagesize` (+ page index). **Keyset** on some endpoints
  (unidentified — do **not** assume `pagesize` works on them). `[DOCUMENTED]` 🔬
- **Default page size:** not documented — **always send `criteria.pagesize` explicitly**. `[UNKNOWN]` 🔬
- **Max page size:** **1000** (non-keyset endpoints). `[DOCUMENTED]`
- **Total count available:** Yes — `totalItems` in the envelope. `[DOCUMENTED]`

### Request Parameters

| Parameter           | Type  | Default | Description                              |
| ------------------- | ----- | ------- | ---------------------------------------- |
| `criteria.pagesize` | int   | —       | Records per page (max 1000)              |
| `criteria.page`     | int   | —       | Page index — **spelling unconfirmed** 🔬 |
| `criteria.Id`       | mixed | —       | Filter to a single record id             |

### Response Structure

```json
{
  "totalItems": 312,
  "items": [
    /* … */
  ]
}
```

### Last Page Detection

`(page * pagesize) >= totalItems`, **or** `items.length < pagesize` → no more pages. `[INFERRED]`

### Full Pagination Loop

```
page = 1
loop:
  GET …/Organisation/{Slug}/{Resource}?criteria.pagesize=1000&criteria.page={page}   # param name 🔬
  process response.items
  fetched += response.items.length
  if fetched >= response.totalItems OR response.items.length < 1000: stop
  page += 1
```

⚠️ With a 300/day budget, a resource over ~300k records cannot be fully paged in a day at
`pagesize=1000`. Prefer targeted `criteria.Id` reads over full scans.

---

## Worked Examples

### Example 1: First 200 active-looking projects

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.pagesize=200
```

```json
{
  "totalItems": 312,
  "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active", "clientId": "551" }]
}
```

**Key points:** read `totalItems` to decide whether to fetch more; `status` filtering is
**client-side** until the server filter syntax is confirmed. 🔬

### Example 2: One project by id

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042
```

```json
{ "totalItems": 1, "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade" }] }
```

**Key points:** single fetch is a filtered list, not a `/Projects/{id}` path — read `items[0]`.

### Example 3: Resolve staff for a timesheet write

```http
GET /api/v2/Organisation/acme-eng/Staff?criteria.pagesize=1000
```

```json
{ "totalItems": 42, "items": [{ "id": "88", "name": "Sam Taylor" }] }
```

**Key points:** resolve a valid `staffId` here **before** posting a timesheet entry to Transactions.

---

## Gotchas & Counter-Exceptions

1. **Token header is `access-token`, not `Authorization: Bearer`** — wrong header → 401 on every read.
2. **Single fetch is a filtered list:** use `?criteria.Id=…`; there is no `…/{Resource}/{id}` path. Read `items[0]`.
3. **Response is enveloped, not a bare array:** read `response.items`, not `response[0]`.
4. **`criteria.pagesize` over 1000 is rejected/clamped** — never request more than 1000.
5. **Keyset endpoints exist but are unidentified** — `pagesize`/`page` may not work on them; confirm per endpoint. 🔬
6. **Every read spends daily budget** — there is no per-second limit to wait out; once 300 is hit, you're done for the day.

---

_Generated from the investigation questionnaire, Phases 5–6._
