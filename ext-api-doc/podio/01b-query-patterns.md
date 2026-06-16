---
api_name: Podio
api_slug: podio
base_url: https://api.podio.com
path_version_segment: none (core API unversioned)
call_surface: HTTP JSON via `connect_request`
confidence: all [DOCUMENTED] (developers.podio.com) unless tagged [INFERRED]
companion_of: 01-llm-api-rules.md
scope: read ops — discovery, filter, get-by-id, get-by-external-id, count, search, pagination
---

# Podio — Query Patterns Reference

**Golden rule:** resolve the app schema (`GET /app/{app_id}`) BEFORE building any filter — filters are keyed by `field_id` and the value shape depends on the field's `type`.

## Query Capabilities Summary

| Capability                      | Supported    | Syntax / Where                                       | Notes                                          |
| ------------------------------- | ------------ | ---------------------------------------------------- | ---------------------------------------------- |
| Filter by field value           | yes          | `filters:{"{field_id}":value}` in POST body          | Keyed by **field_id** (int), NOT name          |
| Filter by date range            | yes          | `filters:{"{date_field_id}":{from,to}}`              | Also special keys `created_on`, `last_edit_on` |
| Filter by category/picklist     | yes          | `filters:{"{cat_field_id}":[optId,optId]}`           | Array of option IDs (OR within the field)      |
| Full-text search                | partial      | separate Search API (`POST /search/app/{app_id}/v2`) | NOT inside the filter body                     |
| Sort by field                   | yes          | `sort_by:"{field_id}"` (or special key)              | One sort key only                              |
| Sort direction                  | yes          | `sort_desc:true\|false`                              | Boolean, not `-field`                          |
| Field selection / sparse fields | no (items)   | items always return ALL populated fields             | `fields=` view only on `GET /app`              |
| Include related records         | partial      | app-reference fields embed `{item_id,title}` inline  | One hop only; no deep expand                   |
| Aggregate / count               | count only   | `POST /item/app/{app_id}/count` + filter             | No group-by                                    |
| Logical AND / OR                | **AND only** | multiple keys in `filters` are ANDed                 | No cross-field OR in one request               |
| Comparison operators (gt/lt)    | range-only   | `{from,to}` for numbers/dates                        | No standalone `gt`/`lt`                        |
| Null checks                     | partial      | per-field handling                                   | [INFERRED]                                     |
| Regex / pattern                 | no           | substring text match only                            |                                                |

## Common Patterns

### Pattern 0: Discovery (always first)

Walk down and read the schema:

```
GET /org/                  → user's orgs (+ embedded spaces)
GET /org/100200/space/     → spaces in org 100200
GET /space/300400/app/     → apps in space 300400
GET /app/500600            → THE schema: fields[].{field_id, external_id, type, config}
```

Cache `external_id → {field_id, type, options}` for the app, then build filters against the `field_id`s.

### Pattern 1: List & Filter

`POST /item/app/{app_id}/filter` — the primary read. Body is JSON; **filters keyed by `field_id`**, value shape type-specific.

```
POST /item/app/500600/filter
{"filters":{"60048455":[1,3],"60048460":{"from":1000,"to":50000},"60048465":{"from":"2026-05-01","to":"2026-05-29"},"60048450":"acme","created_on":{"from":"2026-05-01 00:00:00","to":"2026-05-29 23:59:59"},"tags":["urgent"]},"sort_by":"last_edit_on","sort_desc":true,"limit":100,"offset":0,"remember":false}
```

Per-type filter value shapes:

```
category  → [optionId, optionId]                       (OR within the field)
number    → {"from":n,"to":m}                           (inclusive range)
date      → {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}
text      → "substring"
app (ref) → [itemId, itemId]
contact   → [profileId, profileId]
```

- `filters` keys are `field_id` integers (quoted JSON keys) OR special keys: `created_on`, `created_by`, `last_edit_on`, `tags`.
- Multiple keys are ANDed. No cross-field OR — for OR, issue multiple requests and merge client-side.
- `remember:false` keeps it ad-hoc; `true` saves it as a view — don't set for one-off queries.
- ⚠️ HEAVY op — counts against the **250/hr** pool.

### Pattern 2: Get by ID

`GET /item/12345` → the single item object (not array-wrapped), with full type-tagged `values`. See 01a §Field Format for per-type value shapes.

### Pattern 3: Get by external_id (dedupe / upsert lookup)

`GET /item/app/500600/external_id/EXT-2024-001` → the item whose caller-supplied `external_id` matches — Podio's only dedupe primitive. 404 `not_found` if none. Use before a create to make it idempotent (lookup-then-create-or-update).

### Pattern 4: Count without fetching

`POST /item/app/500600/count` body `{"filters":{"60048455":[1,2]}}` → `{"count":45}`. Cheaper than pulling items when you only need the size. Still a heavy op.

### Pattern 5: Date-range query

Use a date field's `field_id`, or the special `created_on`/`last_edit_on` keys. **Datetimes bare UTC** — no `Z`, no offset.

```
POST /item/app/500600/filter
{"filters":{"last_edit_on":{"from":"2026-05-01 00:00:00","to":"2026-05-29 23:59:59"}},"sort_by":"last_edit_on","sort_desc":true,"limit":100}
```

Date-only fields accept `YYYY-MM-DD`; datetime fields accept `YYYY-MM-DD HH:MM:SS`.

### Pattern 6: Search (separate Search API)

Full-text search is NOT in the filter body — its own API.

```
POST /search/app/500600/v2
{"query":"acme","limit":20}
```

- App search: `POST /search/app/{app_id}/v2` (within one app). Space search: `POST /search/space/{space_id}/v2`. Org/global: `GET /search/v2/…` style.
- Searchable content: indexed text of items, comments, files. Fuzzy: substring/token match, no Levenshtein [INFERRED]. Min query length ≥1 non-whitespace char [INFERRED].
- HEAVY op (250/hr pool). Prefer `filter` when you know the field; use `search` for "find anything about X".

## Pagination

- Offset-based (`limit`+`offset`) in the filter body. Default 30; treat **100** as per-call ceiling and page with `offset` (the docs' "up to 500" line describes a multi-request pattern, not a single-call max).
- Every filter response carries `total` (all items in app) and `filtered` (matching). Use **`filtered`** as the loop bound.

| Parameter | Type | Default | Description              |
| --------- | ---- | ------- | ------------------------ |
| `limit`   | int  | 30      | Items per page (cap 100) |
| `offset`  | int  | 0       | Items to skip            |

Response: `{"total":482,"filtered":120,"items":[/* up to limit */]}`. Last page when `offset + items.length >= filtered` OR `items.length < limit`.

```
Page 1: POST /item/app/500600/filter {"limit":100,"offset":0}   → {filtered:250, items:[100]}
Page 2: POST /item/app/500600/filter {"limit":100,"offset":100} → {filtered:250, items:[100]}
Page 3: POST /item/app/500600/filter {"limit":100,"offset":200} → {filtered:250, items:[50]}  // 50<100 → last
Stop when offset + len(items) >= filtered  (300 >= 250).
```

⚠️ Each page is a HEAVY call — paging a large app burns the 250/hr pool fast. Always page `limit:100` (not default 30); prefer an incremental `last_edit_on` filter over a full sweep.

## Bulk Read

| Operation             | Endpoint                         | Max batch | Notes                    |
| --------------------- | -------------------------------- | --------- | ------------------------ |
| Bulk read / batch get | `POST /item/app/{app_id}/filter` | 100/page  | The read batch mechanism |
| Count                 | `POST /item/app/{app_id}/count`  | —         | Size only, no items      |

No async export API for items. Bulk extraction = paginate `filter`. For large apps, run an overnight offset-paged sweep keyed on `last_edit_on` for incremental pulls, inside the 250/hr cap.

## Worked Examples

### Example 1: Open leads created this month, freshest first

Discovery: `status` = field `60048455`, option `1`="Open"; date field is `created_on`.

```
POST /item/app/500600/filter
{"filters":{"60048455":[1],"created_on":{"from":"2026-05-01 00:00:00","to":"2026-05-31 23:59:59"}},"sort_by":"created_on","sort_desc":true,"limit":100}
```

→ `{"total":482,"filtered":17,"items":[{"item_id":12345,"external_id":"EXT-2024-001","title":"Acme renewal","created_on":"2026-05-15 10:30:00","fields":[{"field_id":60048455,"external_id":"status","type":"category","values":[{"value":{"id":1,"text":"Open"}}]},{"field_id":60048460,"external_id":"amount","type":"money","values":[{"value":"50000.00","currency":"USD"}]}]}]}`

- `filters` keyed by `field_id`; category value is an array of option IDs.
- `filtered` (17) is the paging bound, not `total` (482).
- Money reads back as `{value:"string",currency}` — convert to a number before maths.

### Example 2: Items above a money threshold (open-ended range)

`POST /item/app/500600/filter` body `{"filters":{"60048460":{"from":10000}},"sort_by":"created_on","sort_desc":true,"limit":100}`
`{from}` without `to` is an open upper bound (≥10000). Number filters use the field's `field_id`.

### Example 3: "Find anything about Acme" — emulate cross-field OR

Filter API is AND-only, so OR across fields needs a fan-out:

- **(a) Search API** (one call, looser match): `POST /search/app/500600/v2` body `{"query":"acme","limit":20}`
- **(b) Multiple filters merged client-side** (precise, multiple heavy calls):
  `POST /item/app/500600/filter {"filters":{"60048450":"acme"},"limit":100}` # title text
  `POST /item/app/500600/filter {"filters":{"60048470":"acme"},"limit":100}` # company text
  Merge the two `items[]` arrays by `item_id`, dedupe.
  Prefer (a) for fuzzy "find anything", (b) for exact field-scoped matches. Both draw from the 250/hr heavy pool — keep fan-out small.

## Gotchas & Counter-Exceptions

1. **Filters keyed by `field_id`, NOT `external_id` and NOT field name.** Resolve IDs via `GET /app/{app_id}` first. A name/`external_id` as a filter key is silently ignored / errors.
2. **No cross-field OR.** Multiple `filters` keys AND together. For OR, fan out and merge.
3. **No sparse fieldsets on item reads.** Every returned item carries all its populated fields — can't ask for just two. (`fields=` view param applies only to `GET /app/{app_id}`.)
4. **`number` reads back as a STRING** (`values:[{value:"123.45"}]`). Parse before arithmetic; write back as a real number.
5. **Datetime filters are bare UTC** (`"2026-05-01 00:00:00"`) — a `Z`/`+10:00` suffix → `invalid_value`.
6. **`filtered` vs `total`.** `total` = whole app; `filtered` = your result set. Loop against `filtered`.
7. **Filter/count/search are HEAVY (250/hr).** Wide pages, incremental filters, no aggressive polling.
8. **One sort key only.** Default sort `created_on` desc. No multi-key sort.
