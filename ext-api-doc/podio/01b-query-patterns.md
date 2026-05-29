---
api_name: 'Podio'
api_slug: 'podio'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Podio -- Query Patterns Reference

> Read operations: discovery, filter, get-by-id, get-by-external-id, count, search, pagination.
> Companion to `01-llm-api-rules.md`.
>
> **Golden rule:** resolve the app schema (`GET /app/{app_id}`) BEFORE building any filter —
> filters are keyed by `field_id` and the value shape depends on the field's `type`.
> Confidence: [DOCUMENTED] from developers.podio.com unless marked; live-gate not yet run.

---

## Query Capabilities Summary

| Capability                      | Supported    | Syntax / Where                                       | Notes                                          |
| ------------------------------- | ------------ | ---------------------------------------------------- | ---------------------------------------------- | --------------------- |
| Filter by field value           | yes          | `filters: { "{field_id}": value }` in the POST body  | Keyed by **field_id** (int), NOT name          |
| Filter by date range            | yes          | `filters: { "{date_field_id}": {from, to} }`         | Also special keys `created_on`, `last_edit_on` |
| Filter by category / picklist   | yes          | `filters: { "{cat_field_id}": [optId, optId] }`      | Array of option IDs (OR within the field)      |
| Full-text search                | partial      | separate Search API (`POST /search/app/{app_id}/v2`) | NOT inside the filter body                     |
| Sort by field                   | yes          | `sort_by: "{field_id}"` (or special key)             | One sort key only                              |
| Sort direction (asc/desc)       | yes          | `sort_desc: true                                     | false`                                         | Boolean, not `-field` |
| Field selection / sparse fields | no (items)   | items always return ALL populated fields             | `fields=` view only on `GET /app`              |
| Include related records         | partial      | app-reference fields embed `{item_id, title}` inline | One hop only; no deep expand                   |
| Aggregate / count               | count only   | `POST /item/app/{app_id}/count` + filter             | No group-by                                    |
| Logical AND / OR                | **AND only** | multiple keys in `filters` are ANDed                 | No cross-field OR in one request               |
| Comparison operators (gt/lt)    | range-only   | `{from, to}` for numbers/dates                       | No standalone `gt`/`lt`                        |
| Null checks                     | partial      | per-field handling                                   | [INFERRED]                                     |
| Regex / pattern                 | no           | substring text match only                            |                                                |

---

## Common Patterns

### Pattern 0: Discovery (always first)

You can't filter what you can't name. Walk down and read the schema:

```http
GET /org/                         → user's orgs (+ embedded spaces)
GET /org/100200/space/            → spaces in org 100200
GET /space/300400/app/            → apps in space 300400
GET /app/500600                   → THE schema: fields[].{field_id, external_id, type, config}
```

Cache `external_id → {field_id, type, options}` for the app, then build filters against the `field_id`s.

---

### Pattern 1: List & Filter

`POST /item/app/{app_id}/filter` is the primary read. The body is JSON; **filters are keyed by `field_id`**, value shape is type-specific.

```http
POST /item/app/500600/filter
Content-Type: application/json

{
  "filters": {
    "60048455": [1, 3],
    "60048460": { "from": 1000, "to": 50000 },
    "60048465": { "from": "2026-05-01", "to": "2026-05-29" },
    "60048450": "acme",
    "created_on": { "from": "2026-05-01 00:00:00", "to": "2026-05-29 23:59:59" },
    "tags": ["urgent"]
  },
  "sort_by": "last_edit_on",
  "sort_desc": true,
  "limit": 100,
  "offset": 0,
  "remember": false
}
```

**Per-type filter value shapes:**

```
category  → [optionId, optionId]                        (OR within the field)
number    → { "from": n, "to": m }                      (inclusive range)
date      → { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
text      → "substring"
app (ref) → [itemId, itemId]
contact   → [profileId, profileId]
```

- **`filters` keys** are `field_id` integers (as JSON object keys, i.e. quoted) OR special keys: `created_on`, `created_by`, `last_edit_on`, `tags`.
- **Multiple keys are ANDed.** There is no cross-field OR — for OR, issue multiple requests and merge client-side.
- `remember: false` keeps it ad-hoc; `true` saves it as a view — don't set it for one-off queries.
- ⚠️ This is a **HEAVY (rate-limited) op** — counts against the 250/hr pool.

---

### Pattern 2: Get by ID

```http
GET /item/12345
```

Returns the single item object (not wrapped in an array), with full type-tagged `values`. See 01a §Field Format for the per-type value shapes.

---

### Pattern 3: Get by external_id (dedupe / upsert lookup)

```http
GET /item/app/500600/external_id/EXT-2024-001
```

Resolves the item whose caller-supplied `external_id` matches — Podio's only dedupe primitive. Returns 404 `not_found` if none. Use this before a create to make the create idempotent (lookup-then-create-or-update).

---

### Pattern 4: Count without fetching

```http
POST /item/app/500600/count
Content-Type: application/json

{ "filters": { "60048455": [1, 2] } }
```

```json
{ "count": 45 }
```

Cheaper than pulling items when you only need the size of a result set. Still a heavy op.

---

### Pattern 5: Date-range query

Use a date field's `field_id`, or the special `created_on` / `last_edit_on` keys. **Datetimes are bare UTC** — no `Z`, no offset.

```http
POST /item/app/500600/filter
{
  "filters": { "last_edit_on": { "from": "2026-05-01 00:00:00", "to": "2026-05-29 23:59:59" } },
  "sort_by": "last_edit_on", "sort_desc": true, "limit": 100
}
```

Date-only fields accept `YYYY-MM-DD`; datetime fields accept `YYYY-MM-DD HH:MM:SS`.

---

### Pattern 6: Search (separate Search API)

Full-text search is NOT in the filter body — it's its own API.

```http
POST /search/app/500600/v2
Content-Type: application/json

{ "query": "acme", "limit": 20 }
```

- **App search:** `POST /search/app/{app_id}/v2` — text search within one app.
- **Space search:** `POST /search/space/{space_id}/v2`.
- **Org/global search:** `GET /search/v2/…` style endpoints.
- **Searchable content:** indexed text of items, comments, files.
- **Fuzzy:** substring/token match; no Levenshtein. [INFERRED]
- **Min query length:** ≥1 non-whitespace char. [INFERRED]
- Search is a **heavy op** (250/hr pool). Prefer `filter` when you know the field; use `search` for "find anything about X".

---

## Pagination Handling

### Model

- **Type:** offset-based (`limit` + `offset`) in the filter body.
- **Default page size:** 30.
- **Max page size:** treat **100** as the per-call ceiling and page with `offset`. (The docs' "up to 500" line describes a multi-request pattern, not a single-call max.)
- **Total count available:** yes — every filter response carries `total` (all items in app) and `filtered` (items matching). Use **`filtered`** as the loop bound.

### Request Parameters (in the filter body)

| Parameter | Type | Default | Description               |
| --------- | ---- | ------- | ------------------------- |
| `limit`   | int  | 30      | Items per page (cap 100). |
| `offset`  | int  | 0       | Items to skip.            |

### Response Structure

```json
{
  "total": 482,
  "filtered": 120,
  "items": [
    /* up to `limit` items */
  ]
}
```

### Last Page Detection

`offset + items.length >= filtered`, OR `items.length < limit`.

### Full Pagination Loop

```
Page 1: POST /item/app/500600/filter  { "limit": 100, "offset": 0 }
        → { filtered: 250, items: [100] }
Page 2: POST /item/app/500600/filter  { "limit": 100, "offset": 100 }
        → { filtered: 250, items: [100] }
Page 3: POST /item/app/500600/filter  { "limit": 100, "offset": 200 }
        → { filtered: 250, items: [50] }     // 50 < 100 → last page
Stop when offset + len(items) >= filtered  (300 >= 250).
```

⚠️ Each page is a HEAVY call — paging a large app burns the 250/hr pool fast. Always page with `limit:100` (not the default 30), and prefer an incremental `last_edit_on` filter over a full sweep.

---

## Bulk Read

| Operation             | Endpoint                         | Max batch | Notes                    |
| --------------------- | -------------------------------- | --------- | ------------------------ |
| Bulk read / batch get | `POST /item/app/{app_id}/filter` | 100/page  | The read batch mechanism |
| Count                 | `POST /item/app/{app_id}/count`  | —         | Size only, no items      |

There is **no async export API** for items. Bulk extraction = paginate `filter`. For large apps, run an overnight, offset-paged sweep keyed on `last_edit_on` for incremental pulls, and stay inside the 250/hr heavy cap.

---

## Worked Examples

### Example 1: Open leads created this month, freshest first

Assume discovery told us `status` is field `60048455` with option `1` = "Open", and the date field is `created_on`.

```http
POST /item/app/500600/filter
Content-Type: application/json

{
  "filters": {
    "60048455": [1],
    "created_on": { "from": "2026-05-01 00:00:00", "to": "2026-05-31 23:59:59" }
  },
  "sort_by": "created_on",
  "sort_desc": true,
  "limit": 100
}
```

```json
{
  "total": 482,
  "filtered": 17,
  "items": [
    {
      "item_id": 12345,
      "external_id": "EXT-2024-001",
      "title": "Acme renewal",
      "created_on": "2026-05-15 10:30:00",
      "fields": [
        {
          "field_id": 60048455,
          "external_id": "status",
          "type": "category",
          "values": [{ "value": { "id": 1, "text": "Open" } }]
        },
        {
          "field_id": 60048460,
          "external_id": "amount",
          "type": "money",
          "values": [{ "value": "50000.00", "currency": "USD" }]
        }
      ]
    }
  ]
}
```

**Key points:**

- `filters` keyed by `field_id`; category value is an array of option IDs.
- `filtered` (17) is the paging bound, not `total` (482).
- Money reads back as a `{value: "string", currency}` — convert to a number before maths.

---

### Example 2: Items above a money threshold (open-ended range)

```http
POST /item/app/500600/filter
{ "filters": { "60048460": { "from": 10000 } }, "sort_by": "created_on", "sort_desc": true, "limit": 100 }
```

`{from}` without `to` is an open upper bound (≥10000). Number filters use the field's `field_id`.

---

### Example 3: "Find anything about Acme" — emulate cross-field OR

The filter API is AND-only, so OR across fields needs a fan-out. Two ways:

**(a) Search API** (one call, looser match):

```http
POST /search/app/500600/v2
{ "query": "acme", "limit": 20 }
```

**(b) Multiple filters merged client-side** (precise, but multiple heavy calls):

```http
POST /item/app/500600/filter  { "filters": { "60048450": "acme" }, "limit": 100 }   # title text
POST /item/app/500600/filter  { "filters": { "60048470": "acme" }, "limit": 100 }   # company text
```

Merge the two `items[]` arrays by `item_id`, dedupe. Prefer (a) for fuzzy "find anything", (b) when you need exact field-scoped matches. Both draw from the 250/hr heavy pool — keep fan-out small.

---

## Gotchas & Counter-Exceptions

1. **Filters are keyed by `field_id`, not `external_id` and not field name.** Resolve IDs via `GET /app/{app_id}` first. A name or `external_id` as a filter key is silently ignored / errors.
2. **No cross-field OR.** Multiple `filters` keys AND together. For OR, fan out and merge.
3. **No sparse fieldsets on item reads.** Every returned item carries all its populated fields — you can't ask for just two. (The `fields=` view param only applies to `GET /app/{app_id}`.)
4. **`number` reads back as a STRING.** `values:[{value:"123.45"}]`. Parse before arithmetic; write it back as a real number.
5. **Datetime filters are bare UTC.** `"2026-05-01 00:00:00"` — a `Z` or `+10:00` suffix → `invalid_value`.
6. **`filtered` vs `total`.** `total` is the whole app; `filtered` is your result set. Loop against `filtered`.
7. **Filter / count / search are HEAVY (250/hr).** Wide pages, incremental filters, no aggressive polling.
8. **One sort key only.** Default sort is `created_on` desc. No multi-key sort.

---

_Generated from `00-api-investigation-questionnaire.md` Phases 5–6._
